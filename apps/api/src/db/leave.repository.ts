import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  CARRYOVER_POLICY, REMINDER_POLICY, PERIOD_LABELS, requestDays,
  type CalendarEntry, type CarryoverGrant, type ConfigurationInput, type Holiday, type LeaveRequest, type LeaveType, type Policy, type Settings, type Team, type User, type Workspace,
} from '@leave/contracts';
import { Database } from './database.js';
import { LeaveStore, type TeamTransaction } from '../leave.store.js';
import { balancesFor, isReserved, RuleError } from '../domain/rules.js';
import { Clock } from '../clock.js';
import { ENVIRONMENT, type Environment } from '../config.js';

export const userColumns = 'id, name, email, role, team_id AS "teamId", CASE WHEN photo IS NULL THEN NULL ELSE photo_version END AS "photoVersion"';
const typeColumns = 'id, name, yearly_allowance AS "yearlyAllowance", carryover_enabled AS "carryoverEnabled"';
const settingsColumns = 'min_notice_days AS "minNoticeDays", max_team_off AS "maxTeamOff", version';
const requestColumns = `
  r.id, r.employee_id AS "employeeId", u.name AS "employeeName", u.team_id AS "teamId",
  t.name AS "teamName", r.leave_type_id AS "leaveTypeId", lt.name AS "leaveTypeName",
  r.start_date::text AS "startDate", r.end_date::text AS "endDate",
  to_json(r.working_dates) AS "workingDates", r.reason, r.status,
  r.created_at AS "createdAt", r.decided_at AS "decidedAt",
  r.decided_by AS "decidedBy", r.decision_note AS "decisionNote",
  r.period, r.version, r.updated_at AS "updatedAt", r.carryover_by_year AS "carryoverByYear"`;
const requestJoins = `FROM leave_requests r
  JOIN users u ON u.id = r.employee_id
  JOIN teams t ON t.id = u.team_id
  JOIN leave_types lt ON lt.id = r.leave_type_id`;
type RequestRow = Omit<LeaveRequest, 'createdAt' | 'decidedAt' | 'updatedAt'> & { createdAt: Date; decidedAt: Date | null; updatedAt: Date };
type Queryable = Pool | PoolClient;

function mapRequest(row: RequestRow): LeaveRequest {
  return { ...row, createdAt: row.createdAt.toISOString(), decidedAt: row.decidedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
}

export async function readPolicy(client: Queryable, lock: 'share' | 'update' | 'none' = 'none'): Promise<Policy> {
  const suffix = lock === 'share' ? ' FOR SHARE' : lock === 'update' ? ' FOR UPDATE' : '';
  const { rows: settings } = await client.query<Settings>(`SELECT ${settingsColumns} FROM settings${suffix}`);
  if (!settings[0]) throw new Error('Database configuration is missing. Run the migrations.');
  const { rows: leaveTypes } = await client.query<LeaveType>(`SELECT ${typeColumns} FROM leave_types ORDER BY name`);
  const { rows: holidays } = await client.query<Holiday>('SELECT date::text AS date, name FROM holidays ORDER BY date');
  return { settings: settings[0], leaveTypes, holidays };
}

async function readRequests(client: Queryable, teamId: string | null, year: number | null = null) {
  const { rows } = await client.query<RequestRow>(`
    SELECT ${requestColumns} ${requestJoins}
    WHERE ($1::uuid IS NULL OR u.team_id = $1)
      AND ($2::int IS NULL OR (r.start_date <= make_date($2, 12, 31) AND r.end_date >= make_date($2, 1, 1)))
    ORDER BY r.created_at DESC, r.id`, [teamId, year]);
  return rows.map(mapRequest);
}

function calendarEntry(request: LeaveRequest): CalendarEntry {
  const { id, employeeId, employeeName, teamId, leaveTypeName, startDate, endDate, workingDates, status, period, version, updatedAt } = request;
  return { id, employeeId, employeeName, teamId, leaveTypeName, startDate, endDate, workingDates, status, period, version, updatedAt };
}

async function readCarryovers(client: Queryable, teamId: string | null): Promise<CarryoverGrant[]> {
  const { rows } = await client.query<Omit<CarryoverGrant, 'days'> & { halfUnits: number }>(`
    SELECT g.employee_id AS "employeeId", g.leave_type_id AS "leaveTypeId", g.year,
      g.half_units AS "halfUnits", g.expires_on::text AS "expiresOn"
    FROM carryover_grants g JOIN users u ON u.id = g.employee_id
    WHERE ($1::uuid IS NULL OR u.team_id = $1)`, [teamId]);
  return rows.map(({ halfUnits, ...grant }) => ({ ...grant, days: halfUnits / 2 }));
}

async function grantCarryover(client: PoolClient, policy: Policy, requests: LeaveRequest[], teamId: string | null, today: string) {
  const year = Number(today.slice(0, 4));
  if (year < CARRYOVER_POLICY.firstYear) return;
  const existing = await readCarryovers(client, teamId);
  const issued = new Set(existing.filter((grant) => grant.year === year).map((grant) => `${grant.employeeId}:${grant.leaveTypeId}`));
  const people = await client.query<{ id: string; eligible: boolean }>(`
    SELECT id, (is_active AND created_at < $2::date) AS eligible FROM users
    WHERE role = 'employee' AND ($1::uuid IS NULL OR team_id = $1)`, [teamId, `${year}-01-01`]);
  const types = await client.query<{ id: string }>('SELECT id FROM leave_types WHERE created_at < $1::date', [`${year}-01-01`]);
  const eligibleTypes = new Set(types.rows.map((type) => type.id));
  const grants: { employee_id: string; leave_type_id: string; year: number; half_units: number; expires_on: string }[] = [];
  for (const employee of people.rows) {
    const previous = balancesFor(employee.id, year - 1, policy.leaveTypes, requests, existing, today);
    for (const type of policy.leaveTypes) {
      if (issued.has(`${employee.id}:${type.id}`)) continue;
      const balance = previous.find((item) => item.leaveTypeId === type.id)!;
      const amount = employee.eligible && eligibleTypes.has(type.id) && type.carryoverEnabled
        ? Math.min(CARRYOVER_POLICY.maxDays, Math.max(0, balance.baseRemaining)) : 0;
      if (!Number.isInteger(amount * 2)) throw new Error('Carry-over must use half-day units.');
      grants.push({ employee_id: employee.id, leave_type_id: type.id, year, half_units: amount * 2,
        expires_on: `${year}-${String(CARRYOVER_POLICY.expiryMonth).padStart(2, '0')}-${String(CARRYOVER_POLICY.expiryDay).padStart(2, '0')}` });
    }
  }
  if (grants.length) {
    await client.query(`INSERT INTO carryover_grants (employee_id, leave_type_id, year, half_units, expires_on)
      SELECT employee_id, leave_type_id, year, half_units, expires_on FROM jsonb_to_recordset($1::jsonb)
      AS g(employee_id uuid, leave_type_id uuid, year integer, half_units integer, expires_on date)
      ON CONFLICT DO NOTHING`, [JSON.stringify(grants)]);
  }
}

@Injectable()
export class PgLeaveRepository extends LeaveStore {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) { super(); }

  transaction<T>(teamId: string, work: (context: TeamTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (client) => {
      const now = this.clock.now().toISOString();
      // Every reservation locks policy first, then its team. Admin changes take the policy's exclusive lock.
      const policy = await readPolicy(client, 'share');
      const { rows: teams } = await client.query<Team>('SELECT id, name FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
      if (!teams[0]) throw new RuleError(404, 'Team not found.');
      const requests = await readRequests(client, teamId);
      await grantCarryover(client, policy, requests, teamId, now.slice(0, 10));
      const carryovers = await readCarryovers(client, teamId);
      const employees = await client.query<{ id: string }>("SELECT id FROM users WHERE team_id = $1 AND role = 'employee' AND is_active", [teamId]);
      return work({
        policy, team: teams[0], requests, carryovers, now, employeeIds: employees.rows.map((employee) => employee.id),
        insert: async (request) => {
          const { rows } = await client.query<{ id: string }>(`
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, working_dates, reason, created_at, period, updated_at, carryover_by_year)
            VALUES ($1, $2, $3, $4, $5::date[], $6, $7, $8, $9, $10::jsonb) RETURNING id`,
          [request.employeeId, request.leaveTypeId, request.startDate, request.endDate, request.workingDates, request.reason, request.createdAt,
            request.period ?? 'full', request.updatedAt ?? request.createdAt, JSON.stringify(request.carryoverByYear ?? {})]);
          const saved = { ...request, id: rows[0].id };
          await this.notify(client, saved, 'New leave request',
            `${request.employeeName} requested ${request.leaveTypeName} leave from ${request.startDate} to ${request.endDate} (${requestDays(request)} days, ${PERIOD_LABELS[request.period ?? 'full']}).`, 'created', now);
          return saved;
        },
        update: async (request) => {
          await client.query(`UPDATE leave_requests
            SET status = $2, decided_at = $3, decided_by = $4, decision_note = $5,
              leave_type_id = $6, start_date = $7, end_date = $8, working_dates = $9::date[],
              reason = $10, period = $11, version = $12, updated_at = $13, carryover_by_year = $14::jsonb,
              last_reminded_at = CASE WHEN $2 = 'pending' THEN NULL ELSE last_reminded_at END
            WHERE id = $1`,
          [request.id, request.status, request.decidedAt, request.decidedBy, request.decisionNote,
            request.leaveTypeId, request.startDate, request.endDate, request.workingDates, request.reason,
            request.period ?? 'full', request.version ?? 1, request.updatedAt ?? now, JSON.stringify(request.carryoverByYear ?? {})]);
          const message = `${request.employeeName}'s ${request.leaveTypeName} leave (${request.startDate} to ${request.endDate}) was ${request.status}.`;
          await this.notify(client, request, request.status === 'pending' ? 'Leave request updated' : `Leave ${request.status}`,
            request.status === 'pending' ? `${request.employeeName} updated a pending request. Review its latest dates and details.` : message,
            request.status === 'pending' ? 'edited' : request.status, now);
          return request;
        },
      });
    });
  }

  async findRequest(id: string) {
    const { rows } = await this.db.pool.query<RequestRow>(`SELECT ${requestColumns} ${requestJoins} WHERE r.id = $1`, [id]);
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async workspace(actor: User, year: number, today: string): Promise<Workspace> {
    await this.ensureCarryover(today, actor.role === 'admin' ? null : actor.teamId);
    return this.db.transaction(async (client) => {
      const policy = await readPolicy(client);
      const teamId = actor.role === 'admin' ? null : actor.teamId;
      const allRequests = await readRequests(client, teamId, year);
      const carryovers = await readCarryovers(client, teamId);
      const { rows: teams } = await client.query<Team>('SELECT id, name FROM teams WHERE ($1::uuid IS NULL OR id = $1) ORDER BY name', [teamId]);
      const { rows: employees } = await client.query<User>(`
        SELECT ${userColumns} FROM users WHERE role = 'employee'
        AND ($1::uuid IS NULL OR team_id = $1) AND ($2::uuid IS NULL OR id = $2) ORDER BY name`,
      [teamId, actor.role === 'employee' ? actor.id : null]);
      const delivery = actor.role === 'admin' ? (await client.query<{ queuedEmails: number; failedEmails: number }>(`
        SELECT count(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS "queuedEmails",
          count(*) FILTER (WHERE status = 'failed')::int AS "failedEmails" FROM email_outbox`)).rows[0] : {};
      return {
        ...policy, user: actor, year, today, teams,
        employees: employees.map((employee) => ({ employee, balances: balancesFor(employee.id, year, policy.leaveTypes, allRequests, carryovers, today) })),
        requests: actor.role === 'employee' ? allRequests.filter((request) => request.employeeId === actor.id) : allRequests,
        calendar: allRequests.filter(isReserved).map(calendarEntry),
        automation: { scheduled: this.environment.JOBS_ENABLED, email: this.environment.EMAIL_ENABLED, ...delivery },
      };
    }, true);
  }

  configure(input: ConfigurationInput): Promise<Policy> {
    return this.db.transaction(async (client) => {
      const current = await readPolicy(client, 'update');
      if (input.settings.version !== current.settings.version) throw new RuleError(409, 'Configuration changed in another session. Refresh before saving.');
      const ids = new Set(input.leaveTypes.map((type) => type.id));
      if (ids.size !== current.leaveTypes.length || current.leaveTypes.some((type) => !ids.has(type.id))) {
        throw new RuleError(400, 'Include every current leave type exactly once. Existing types cannot be removed.');
      }
      await grantCarryover(client, current, await readRequests(client, null), null, this.clock.now().toISOString().slice(0, 10));
      for (const type of input.leaveTypes) {
        await client.query('UPDATE leave_types SET name = $2, yearly_allowance = $3, carryover_enabled = $4 WHERE id = $1',
          [type.id, type.name, type.yearlyAllowance, type.carryoverEnabled ?? current.leaveTypes.find((item) => item.id === type.id)!.carryoverEnabled ?? false]);
      }
      await client.query('DELETE FROM holidays');
      for (const holiday of input.holidays) {
        await client.query('INSERT INTO holidays (date, name) VALUES ($1, $2)', [holiday.date, holiday.name]);
      }
      await client.query('UPDATE settings SET min_notice_days = $1, max_team_off = $2, version = version + 1',
        [input.settings.minNoticeDays, input.settings.maxTeamOff]);
      return readPolicy(client);
    });
  }

  addLeaveType(input: Omit<LeaveType, 'id'>): Promise<LeaveType> {
    return this.db.transaction(async (client) => {
      await client.query('SELECT singleton FROM settings FOR UPDATE');
      const { rows } = await client.query<LeaveType>(`INSERT INTO leave_types (name, yearly_allowance, carryover_enabled, created_at) VALUES ($1, $2, $3, $4) RETURNING ${typeColumns}`,
        [input.name, input.yearlyAllowance, input.carryoverEnabled ?? false, this.clock.now().toISOString()]);
      await client.query('UPDATE settings SET version = version + 1');
      return rows[0];
    });
  }

  async ensureCarryover(today = this.clock.now().toISOString().slice(0, 10), teamId: string | null = null): Promise<void> {
    if (Number(today.slice(0, 4)) < CARRYOVER_POLICY.firstYear) return;
    const teams = await this.db.pool.query<{ id: string }>('SELECT id FROM teams WHERE ($1::uuid IS NULL OR id = $1) ORDER BY id', [teamId]);
    for (const team of teams.rows) await this.transaction(team.id, async () => undefined);
  }

  async remindPending(now = this.clock.now().toISOString()): Promise<number> {
    return this.db.transaction(async (client) => {
      const candidates = await client.query<{ id: string }>(`
        SELECT id FROM leave_requests WHERE status = 'pending' AND start_date >= $1::date
          AND updated_at <= $2::timestamptz - $3 * interval '1 hour'
          AND (last_reminded_at IS NULL OR last_reminded_at <= $2::timestamptz - $4 * interval '1 hour')
        ORDER BY updated_at, id LIMIT 100 FOR UPDATE SKIP LOCKED`,
      [now.slice(0, 10), now, REMINDER_POLICY.afterHours, REMINDER_POLICY.repeatHours]);
      for (const { id } of candidates.rows) {
        const result = await client.query<RequestRow>(`SELECT ${requestColumns} ${requestJoins} WHERE r.id = $1`, [id]);
        const request = mapRequest(result.rows[0]);
        await this.notify(client, request, 'Approval reminder',
          `${request.employeeName}'s leave from ${request.startDate} to ${request.endDate} is awaiting review.`,
          `reminder:${now.slice(0, 10)}`, now);
        await client.query('UPDATE leave_requests SET last_reminded_at = $2 WHERE id = $1', [id, now]);
      }
      return candidates.rows.length;
    });
  }

  private async notify(client: PoolClient, request: LeaveRequest, title: string, message: string, event: string, now: string) {
    const managers = request.status === 'pending' || request.status === 'cancelled';
    const result = await client.query<{ id: string }>(`
      INSERT INTO notifications (recipient_id, request_id, title, message, created_at, event_key)
      SELECT id, $1, $2, $3, $4, $5 || ':' || id::text FROM users WHERE is_active AND
        (($6::boolean AND role = 'manager' AND team_id = $7) OR (NOT $6::boolean AND id = $8))
      ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id`,
    [request.id, title, message, now, `${request.id}:${request.version ?? 1}:${event}`, managers, request.teamId, request.employeeId]);
    if (this.environment.EMAIL_ENABLED && result.rows.length) {
      await client.query('INSERT INTO email_outbox (notification_id, next_attempt_at) SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING',
        [result.rows.map((item) => item.id), now]);
    }
  }
}
