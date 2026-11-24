import { ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PasswordInput, Role, User } from '@leave/contracts';
import { Database } from '../db/database.js';
import { userColumns } from '../db/leave.repository.js';
import { Passwords } from './passwords.js';
import { ENVIRONMENT, type Environment } from '../config.js';
import { seededUserIdentity } from './demo-identity.js';

type IdentityRow = User & { sessionVersion: number; passwordHash: string };
const identityColumns = `${userColumns}, session_version AS "sessionVersion", password_hash AS "passwordHash"`;
const publicUser = ({ id, name, email, role, teamId, photoVersion }: User): User => ({ id, name, email, role, teamId, photoVersion });

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(Passwords) private readonly passwords: Passwords,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async findUser(id: string, version: number): Promise<User | null> {
    const { rows } = await this.db.pool.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1 AND is_active AND session_version = $2`, [id, version]);
    return rows[0] ?? null;
  }

  async demoLogin(role: Role): Promise<{ user: User; token: string }> {
    if (!this.environment.DEMO_LOGIN_ENABLED) throw new ForbiddenException('Demo sign-in is disabled. Use your account credentials.');
    const expected = seededUserIdentity(role);
    const { rows } = await this.db.pool.query<IdentityRow>(
      `SELECT ${identityColumns} FROM users WHERE id = $1 AND email = $2 AND role = $3 AND is_active`,
      [expected.id, expected.email, role],
    );
    const user = rows[0];
    if (!user) throw new ServiceUnavailableException('The seeded demo account is unavailable. Ask the administrator to seed the demo data.');
    return this.session(user, true);
  }

  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const { rows } = await this.db.pool.query<IdentityRow>(
      `SELECT ${identityColumns} FROM users WHERE email = $1 AND is_active`, [email.toLowerCase().trim()],
    );
    const credentials = rows[0];
    if (!credentials) {
      // An unknown account still performs the same expensive key derivation.
      await this.passwords.hash(password);
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    if (!await this.passwords.verify(password, credentials.passwordHash)) throw new UnauthorizedException('Email or password is incorrect.');
    return this.session(credentials);
  }

  async changePassword(actor: User, input: PasswordInput, demoSession: boolean) {
    if (demoSession) throw new ForbiddenException('Password changes are unavailable in open demo sessions. Sign in with account credentials.');
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<IdentityRow>(`SELECT ${identityColumns} FROM users WHERE id = $1 AND is_active FOR UPDATE`, [actor.id]);
      const current = rows[0];
      if (!current || !await this.passwords.verify(input.currentPassword, current.passwordHash)) {
        throw new UnauthorizedException('The current password is incorrect.');
      }
      await client.query('UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1',
        [actor.id, await this.passwords.hash(input.newPassword)]);
      return this.session({ ...current, sessionVersion: current.sessionVersion + 1 });
    });
  }

  private async session(identity: IdentityRow, demo = false) {
    return { user: publicUser(identity), token: await this.jwt.signAsync({ sub: identity.id, version: identity.sessionVersion, demo }) };
  }
}
