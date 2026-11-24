import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AccountProfile, CreatePersonInput, ManagedTeam, ManagedUser, PeopleWorkspace, ProfileInput, UpdatePersonInput, User } from '@leave/contracts';
import { Database } from './db/database.js';
import { userColumns } from './db/leave.repository.js';
import { ENVIRONMENT, type Environment } from './config.js';
import { Passwords } from './auth/passwords.js';
import { Clock } from './clock.js';
import { RuleError } from './domain/rules.js';
import { profileImage, type UploadedAsset } from './uploads.js';

const managedColumns = `${userColumns}, phone, job_title AS "jobTitle", is_active AS active,
  EXISTS (SELECT 1 FROM leave_requests WHERE employee_id = users.id) AS "hasLeaveHistory"`;

@Injectable()
export class AccountsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(Passwords) private readonly passwords: Passwords,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async profile(actor: User, demoSession: boolean): Promise<AccountProfile> {
    const { rows } = await this.db.pool.query<User & { phone: string; jobTitle: string; teamName: string | null }>(`
      SELECT ${userColumns}, phone, job_title AS "jobTitle",
        (SELECT name FROM teams WHERE id = users.team_id) AS "teamName"
      FROM users WHERE id = $1`, [actor.id]);
    if (!rows[0]) throw new NotFoundException('Account not found.');
    const { phone, jobTitle, teamName, ...user } = rows[0];
    return { user, phone, jobTitle, teamName, demoSession, sharedDemo: this.environment.DEMO_LOGIN_ENABLED };
  }

  async updateProfile(actor: User, input: ProfileInput, demoSession: boolean) {
    this.employeeOnly(actor);
    await this.db.pool.query('UPDATE users SET name = $2, phone = $3, job_title = $4 WHERE id = $1',
      [actor.id, input.name, input.phone, input.jobTitle]);
    return this.profile(actor, demoSession);
  }

  async updatePhoto(actor: User, file: UploadedAsset | undefined, demoSession: boolean) {
    this.employeeOnly(actor);
    const photo = await profileImage(file);
    await this.db.pool.query('UPDATE users SET photo = $2, photo_version = photo_version + 1 WHERE id = $1', [actor.id, photo]);
    return this.profile(actor, demoSession);
  }

  async removePhoto(actor: User, demoSession: boolean) {
    this.employeeOnly(actor);
    await this.db.pool.query('UPDATE users SET photo = NULL, photo_version = photo_version + 1 WHERE id = $1', [actor.id]);
    return this.profile(actor, demoSession);
  }

  async photo(actor: User): Promise<Buffer> {
    const { rows } = await this.db.pool.query<{ photo: Buffer | null }>('SELECT photo FROM users WHERE id = $1', [actor.id]);
    if (!rows[0]?.photo) throw new NotFoundException('No profile photo has been uploaded.');
    return rows[0].photo;
  }

  async people(actor: User): Promise<PeopleWorkspace> {
    this.adminOnly(actor);
    return this.db.transaction(async (client) => {
      const { rows: users } = await client.query<ManagedUser>(`SELECT ${managedColumns} FROM users ORDER BY role, name`);
      const { rows: teams } = await client.query<ManagedTeam>(`SELECT t.id, t.name,
        (SELECT count(*)::int FROM users WHERE team_id = t.id AND role = 'employee') AS "employeeCount",
        (SELECT id FROM users WHERE team_id = t.id AND role = 'manager') AS "managerId",
        (SELECT name FROM users WHERE team_id = t.id AND role = 'manager') AS "managerName"
        FROM teams t ORDER BY name`);
      return { users, teams };
    }, true);
  }

  async createPerson(actor: User, input: CreatePersonInput): Promise<ManagedUser> {
    this.adminOnly(actor);
    const hash = await this.passwords.hash(input.password);
    return this.db.transaction(async (client) => {
      await client.query('SELECT singleton FROM settings FOR UPDATE');
      await this.requireTeam(client, input.teamId, input.role);
      const { rows } = await client.query<ManagedUser>(`INSERT INTO users
        (name, email, password_hash, role, team_id, phone, job_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING ${managedColumns}`, [input.name, input.email, hash, input.role, input.teamId, input.phone, input.jobTitle, this.clock.now().toISOString()]);
      return rows[0];
    });
  }

  async updatePerson(actor: User, id: string, input: UpdatePersonInput): Promise<ManagedUser> {
    this.adminOnly(actor);
    return this.db.transaction(async (client) => {
      // Match reservation lock ordering so a team move cannot race a new leave request.
      await client.query('SELECT singleton FROM settings FOR UPDATE');
      const { rows } = await client.query<ManagedUser>(`SELECT ${managedColumns} FROM users WHERE id = $1 FOR UPDATE`, [id]);
      const current = rows[0];
      if (!current) throw new NotFoundException('Employee not found.');
      if (current.role === 'admin') throw new ForbiddenException('Admin accounts cannot be changed from people management.');
      if (!input.teamId) throw new RuleError(400, 'Employees and managers must belong to a team.');
      if (current.teamId !== input.teamId && current.hasLeaveHistory) {
        throw new RuleError(409, 'Team assignment is locked once an employee has leave history, to preserve balances and reporting permissions.');
      }
      if (current.role === 'manager' && (!input.active || input.teamId !== current.teamId)) {
        const reports = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM users WHERE role = 'employee' AND team_id = $1", [current.teamId]);
        if (reports.rows[0].count) throw new RuleError(409, 'A manager with assigned employees must remain active in their team.');
      }
      if (!input.active) {
        const activeLeave = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM leave_requests
          WHERE employee_id = $1 AND (status = 'pending' OR (status = 'approved' AND end_date >= $2))`,
        [id, this.clock.now().toISOString().slice(0, 10)]);
        if (activeLeave.rows[0].count) throw new RuleError(409, 'Resolve pending and upcoming approved leave before deactivating this employee.');
      }
      if (input.teamId !== current.teamId || (input.active && !current.active)) await this.requireTeam(client, input.teamId, current.role, id);
      const updated = await client.query<ManagedUser>(`UPDATE users SET name = $2, phone = $3, job_title = $4, team_id = $5,
        session_version = session_version + CASE WHEN is_active <> $6 THEN 1 ELSE 0 END, is_active = $6 WHERE id = $1
        RETURNING ${managedColumns}`, [id, input.name, input.phone, input.jobTitle, input.teamId, input.active]);
      return updated.rows[0];
    });
  }

  async saveTeam(actor: User, name: string, id?: string) {
    this.adminOnly(actor);
    if (!id) return (await this.db.pool.query<{ id: string; name: string }>('INSERT INTO teams (name) VALUES ($1) RETURNING id, name', [name])).rows[0];
    const { rows } = await this.db.pool.query<{ id: string; name: string }>('UPDATE teams SET name = $2 WHERE id = $1 RETURNING id, name', [id, name]);
    if (!rows[0]) throw new NotFoundException('Team not found.');
    return rows[0];
  }

  private async requireTeam(client: PoolClient, teamId: string, role: 'employee' | 'manager', ownId?: string) {
    const team = await client.query('SELECT id FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
    if (!team.rows.length) throw new NotFoundException('Team not found.');
    const managers = await client.query<{ id: string; active: boolean }>("SELECT id, is_active AS active FROM users WHERE team_id = $1 AND role = 'manager'", [teamId]);
    if (role === 'employee' && !managers.rows.some((manager) => manager.active)) throw new RuleError(409, 'Create or activate a manager for this team before assigning employees.');
    if (role === 'manager' && managers.rows.some((manager) => manager.id !== ownId)) throw new RuleError(409, 'This team already has a manager.');
  }

  private employeeOnly(actor: User) {
    if (actor.role !== 'employee') throw new ForbiddenException('Only employees can edit their personal profile.');
  }

  private adminOnly(actor: User) {
    if (actor.role !== 'admin') throw new ForbiddenException('Only admins can manage people and teams.');
  }
}
