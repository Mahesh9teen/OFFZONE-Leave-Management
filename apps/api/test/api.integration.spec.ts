import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
import { z } from 'zod';
import sharp from 'sharp';
import { InMemoryMailTransport, MailMessageError, MailModule, MailTransport } from '@nestjs/mail';
import type { ConfigurationInput, LeaveRequest, Workspace } from '@leave/contracts';
import { AppModule } from '../src/app.module.js';
import { Clock } from '../src/clock.js';
import { ENVIRONMENT, type Environment } from '../src/config.js';
import { configureHttp } from '../src/http/configure.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { PgLeaveRepository } from '../src/db/leave.repository.js';
import { AutomationService } from '../src/automation.service.js';
import { mailOptions, NotificationEmail } from '../src/mail.service.js';

const origin = 'http://localhost:4200';
const schema = `leave_test_${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(18).toString('base64url');
let adminPool: Pool;
let pool: Pool;
let app: NestExpressApplication;
let server: Server;
let annualId: string;
const cookies = new Map<string, string>();
const mailbox = new InMemoryMailTransport();
let clockTime = '2026-01-01T10:00:00.000Z';
const setCookieHeaders = (response: request.Response) => z.array(z.string()).parse(response.headers['set-cookie']);

function api(actor?: string) {
  return {
    get: (path: string) => request(server).get(`/api${path}`).set('Cookie', cookies.get(actor ?? '') ?? ''),
    post: (path: string, body: object) => request(server).post(`/api${path}`).set('Origin', origin).set('Cookie', cookies.get(actor ?? '') ?? '').send(body),
    patch: (path: string, body: object) => request(server).patch(`/api${path}`).set('Origin', origin).set('Cookie', cookies.get(actor ?? '') ?? '').send(body),
    put: (path: string, body: object) => request(server).put(`/api${path}`).set('Origin', origin).set('Cookie', cookies.get(actor ?? '') ?? '').send(body),
    delete: (path: string) => request(server).delete(`/api${path}`).set('Origin', origin).set('Cookie', cookies.get(actor ?? '') ?? ''),
  };
}

function leave(startDate = '2026-01-05', endDate = startDate) {
  return { leaveTypeId: annualId, startDate, endDate, reason: 'A planned break' };
}

async function workspace(actor = 'admin'): Promise<Workspace> {
  const result = await api(actor).get('/workspace?year=2026').expect(200);
  return result.body;
}

async function configuration(): Promise<ConfigurationInput> {
  const { settings, leaveTypes, holidays } = await workspace();
  return { settings, leaveTypes, holidays };
}

beforeAll(async () => {
  const connection = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connection) throw new Error('Integration tests require DATABASE_URL or TEST_DATABASE_URL. Start the project database first.');
  adminPool = new Pool({ connectionString: connection, connectionTimeoutMillis: 5000 });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const isolated = new URL(connection);
  isolated.searchParams.set('options', `-c search_path=${schema}`);
  pool = new Pool({ connectionString: isolated.toString() });
  vi.stubEnv('DATABASE_URL', isolated.toString());
  vi.stubEnv('AUTH_SECRET', randomBytes(48).toString('hex'));
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('COOKIE_SECURE', 'false');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DEMO_LOGIN_ENABLED', 'false');
  vi.stubEnv('EMAIL_ENABLED', 'false');
  vi.stubEnv('JOBS_ENABLED', 'false');
  expect(await migrate(pool)).toBe(true);
  expect(await migrate(pool)).toBe(false);
  expect(await seedDemo(pool, password, '2026-01-01')).toBe(true);
  expect(await seedDemo(pool, password, '2026-01-01')).toBe(false);
  expect((await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM leave_requests')).rows[0].count).toBe(40);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock).useValue({ now: () => new Date(clockTime) })
    .overrideProvider(MailTransport).useValue(mailbox).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureHttp(app, app.get<Environment>(ENVIRONMENT));
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  for (const actor of ['admin', 'manager1', 'manager2', 'employee1', 'employee2', 'employee5']) {
    const result = await api().post('/auth/login', { email: `${actor}@example.test`, password }).expect(200);
    const setCookies = setCookieHeaders(result);
    expect(setCookies[0]).toContain('HttpOnly');
    expect(setCookies[0]).toContain('SameSite=Strict');
    expect(result.body).not.toHaveProperty('passwordHash');
    expect(result.body).not.toHaveProperty('token');
    cookies.set(actor, setCookies[0].split(';')[0]);
  }
  annualId = (await pool.query<{ id: string }>("SELECT id FROM leave_types WHERE name = 'Annual'")).rows[0].id;
});

describe('OFFZONE account and collaboration features', () => {
  const profile = { name: 'Alex Updated', phone: '+1 555 0100', jobTitle: 'Product designer' };
  const corruptPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=', 'base64');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
  const upload = (actor: string, path: string, field: string, content: Buffer, filename: string) =>
    request(server).post(`/api${path}`).set('Origin', origin).set('Cookie', cookies.get(actor)!).attach(field, content, filename);

  it('persists employee profile edits without permitting protected identity fields', async () => {
    const before = await api('employee1').get('/profile').expect(200);
    try {
      await api('employee1').put('/profile', profile).expect(200);
      const after = await api('employee1').get('/profile').expect(200);
      expect(after.body).toMatchObject({ user: { id: before.body.user.id, email: 'employee1@example.test', name: profile.name }, phone: profile.phone, jobTitle: profile.jobTitle });
      await api('employee1').put('/profile', { ...profile, role: 'admin', teamId: randomUUID(), email: 'other@example.test' }).expect(400);
      await api('manager1').put('/profile', profile).expect(403);
    } finally {
      if (before.status === 200) await api('employee1').put('/profile', { name: before.body.user.name, phone: before.body.phone, jobTitle: before.body.jobTitle }).expect(200);
    }
  });

  it('stores a validated employee photo, serves only their own image, and supports removal', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#6254d9' } }).png().toBuffer();
    try {
      const uploaded = await upload('employee1', '/profile/photo', 'photo', png, 'profile.png').expect(201);
      expect(uploaded.body.user.photoVersion).toBeGreaterThan(0);
      const photo = await api('employee1').get('/profile/photo').expect(200);
      expect(photo.headers['content-type']).toContain('image/webp');
      await api('employee2').get('/profile/photo').expect(404);
      await upload('employee1', '/profile/photo', 'photo', Buffer.from('<svg/>'), 'fake.png').expect(400);
      await upload('employee1', '/profile/photo', 'photo', corruptPng, 'corrupt.png').expect(400);
      await upload('employee1', '/profile/photo', 'photo', Buffer.alloc(2 * 1024 * 1024 + 1), 'large.png').expect(413);
      await upload('manager1', '/profile/photo', 'photo', png, 'profile.png').expect(403);
    } finally {
      await api('employee1').delete('/profile/photo').expect(200);
    }
    await api('employee1').get('/profile/photo').expect(404);
  });

  it('requires the current password and invalidates older sessions after a password change', async () => {
    const me = await api('employee2').get('/auth/me').expect(200);
    const original = (await pool.query('SELECT password_hash, session_version FROM users WHERE id = $1', [me.body.id])).rows[0];
    try {
      await api('employee2').post('/profile/password', { currentPassword: 'wrong', newPassword: 'New-test-password-123' }).expect(401);
      const changed = await api('employee2').post('/profile/password', { currentPassword: password, newPassword: 'New-test-password-123' }).expect(200);
      const renewedCookie = setCookieHeaders(changed)[0].split(';')[0];
      await api('employee2').get('/auth/me').expect(401);
      await request(server).get('/api/auth/me').set('Cookie', renewedCookie).expect(200);
      expect((await pool.query('SELECT session_version FROM users WHERE id = $1', [me.body.id])).rows[0].session_version).toBe(original.session_version + 1);
    } finally {
      await pool.query('UPDATE users SET password_hash = $2, session_version = $3 WHERE id = $1', [me.body.id, original.password_hash, original.session_version]);
    }
  });

  it('does not let an open demo session change the shared account password', async () => {
    app.get<Environment>(ENVIRONMENT).DEMO_LOGIN_ENABLED = true;
    const me = await api('employee1').get('/auth/me').expect(200);
    const token = await app.get(JwtService).signAsync({ sub: me.body.id, demo: true, version: 0 });
    const response = await request(server).post('/api/profile/password').set('Origin', origin).set('Cookie', `leave_session=${token}`)
      .send({ currentPassword: password, newPassword: 'Another-test-password-123' }).expect(403);
    expect(response.body.message).toContain('demo');
  });

  it('notifies the reporting manager and employee, and protects each recipient read state', async () => {
    const created = await api('employee1').post('/requests', leave()).expect(201);
    const manager = await api('manager1').get('/notifications').expect(200);
    const entry = manager.body.items.find((item: { requestId: string }) => item.requestId === created.body.id);
    expect(entry).toMatchObject({ title: 'New leave request', readAt: null });
    expect((await api('manager2').get('/notifications').expect(200)).body.items).toHaveLength(0);
    await api('employee1').patch(`/notifications/${entry.id}/read`, {}).expect(404);
    await api('manager1').patch(`/notifications/${entry.id}/read`, {}).expect(200);
    await api('manager1').patch(`/requests/${created.body.id}/status`, { status: 'approved' }).expect(200);
    const employee = await api('employee1').get('/notifications').expect(200);
    expect(employee.body.items[0]).toMatchObject({ title: 'Leave approved', requestId: created.body.id });
    await api('employee1').post('/notifications/read-all', {}).expect(200);
    expect((await api('employee1').get('/notifications').expect(200)).body.unreadCount).toBe(0);
    await api('employee1').patch(`/requests/${created.body.id}/status`, { status: 'cancelled' }).expect(200);
    expect((await api('manager1').get('/notifications').expect(200)).body.items[0].title).toBe('Leave cancelled');
  });

  it('uploads private supporting documents and limits access to the owner, manager, and admin', async () => {
    const created = await api('employee1').post('/requests', leave()).expect(201);
    const path = `/requests/${created.body.id}/documents`;
    const uploaded = await upload('employee1', path, 'files', pdf, 'medical-demo.pdf').expect(201);
    const document = uploaded.body[0];
    expect(document).toMatchObject({ filename: 'medical-demo.pdf', mimeType: 'application/pdf', size: pdf.length });
    expect(document).not.toHaveProperty('content');
    await api('employee2').get(path).expect(403);
    await api('manager2').get(path).expect(403);
    await api('manager1').get(path).expect(200);
    await api('admin').get(path).expect(200);
    const downloaded = await api('manager1').get(`${path}/${document.id}/file`).expect(200);
    expect(downloaded.headers['content-disposition']).toContain('attachment');
    expect(downloaded.headers['content-type']).toContain('application/octet-stream');
    expect(downloaded.body).toEqual(pdf);
    await api('employee2').get(`${path}/${document.id}/file`).expect(403);
    await upload('employee2', path, 'files', pdf, 'other.pdf').expect(403);
    await upload('employee1', path, 'files', Buffer.from('<script>test</script>'), 'fake.pdf').expect(400);
    await upload('employee1', path, 'files', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.pdf').expect(413);
    await api('manager1').delete(`${path}/${document.id}`).expect(403);
    await api('employee1').delete(`${path}/${document.id}`).expect(200);
    expect((await api('employee1').get(path).expect(200)).body).toHaveLength(0);
  });

  it('caps attachments at three and locks them after a decision', async () => {
    const created = await api('employee1').post('/requests', leave()).expect(201);
    const path = `/requests/${created.body.id}/documents`;
    let firstId = '';
    for (let index = 0; index < 3; index++) {
      const result = await upload('employee1', path, 'files', pdf, `demo-${index}.pdf`).expect(201);
      if (!firstId) firstId = result.body[0].id;
    }
    await upload('employee1', path, 'files', pdf, 'extra.pdf').expect(409);
    await api('manager1').patch(`/requests/${created.body.id}/status`, { status: 'approved' }).expect(200);
    await api('employee1').delete(`${path}/${firstId}`).expect(409);
    await upload('employee1', path, 'files', pdf, 'late.pdf').expect(409);
  });

  it('lets only admins create teams and accounts, and safely deactivate a new employee', async () => {
    await api('employee1').get('/admin/people').expect(403);
    await api('manager1').post('/admin/teams', { name: 'Not allowed' }).expect(403);
    const team = await api('admin').post('/admin/teams', { name: `Integration team ${randomUUID().slice(0, 8)}` }).expect(201);
    const ids: string[] = [];
    try {
      const managerInput = { name: 'Integration Manager', email: `integration-${randomUUID()}@example.test`, role: 'manager', teamId: team.body.id, password, phone: '', jobTitle: '' };
      const manager = await api('admin').post('/admin/people', managerInput).expect(201);
      ids.push(manager.body.id);
      const employee = await api('admin').post('/admin/people', { ...managerInput, name: 'Integration Employee', email: `integration-${randomUUID()}@example.test`, role: 'employee' }).expect(201);
      ids.push(employee.body.id);
      expect(employee.body).not.toHaveProperty('passwordHash');
      const directory = await api('admin').get('/admin/people').expect(200);
      expect(directory.body.teams.find((item: { id: string }) => item.id === team.body.id))
        .toMatchObject({ employeeCount: 1, managerId: manager.body.id, managerName: managerInput.name });
      expect(directory.body.users.find((item: { id: string }) => item.id === employee.body.id)).toMatchObject({ active: true, hasLeaveHistory: false });
      await api('admin').post('/admin/people', { ...managerInput, email: `integration-${randomUUID()}@example.test` }).expect(409);
      const token = await app.get(JwtService).signAsync({ sub: employee.body.id, version: 0 });
      await request(server).get('/api/auth/me').set('Cookie', `leave_session=${token}`).expect(200);
      await api('admin').put(`/admin/people/${employee.body.id}`, { name: 'Integration Employee', phone: '', jobTitle: '', teamId: team.body.id, active: false }).expect(200);
      await request(server).get('/api/auth/me').set('Cookie', `leave_session=${token}`).expect(401);
      await api('admin').put(`/admin/teams/${team.body.id}`, { name: `Integration renamed ${randomUUID().slice(0, 8)}` }).expect(200);
      await api('admin').post('/admin/people', { ...managerInput, role: 'admin' }).expect(400);
    } finally {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM teams WHERE id = $1', [team.body.id]);
    }
  });

  it('preserves leave history and manager coverage during administrative changes', async () => {
    const employee = (await api('employee1').get('/auth/me').expect(200)).body;
    await api('employee1').post('/requests', leave()).expect(201);
    const otherTeam = (await api('manager2').get('/auth/me').expect(200)).body.teamId;
    const input = { name: employee.name, phone: '', jobTitle: '', teamId: otherTeam, active: true };
    await api('admin').put(`/admin/people/${employee.id}`, input).expect(409);
    await api('admin').put(`/admin/people/${employee.id}`, { ...input, teamId: employee.teamId, active: false }).expect(409);
    const manager = (await api('manager1').get('/auth/me').expect(200)).body;
    await api('admin').put(`/admin/people/${manager.id}`, { ...input, teamId: manager.teamId, active: false }).expect(409);
  });
});

beforeEach(async () => {
  clockTime = '2026-01-01T10:00:00.000Z';
  mailbox.clear();
  app.get<Environment>(ENVIRONMENT).DEMO_LOGIN_ENABLED = false;
  app.get<Environment>(ENVIRONMENT).EMAIL_ENABLED = false;
  await pool.query('DELETE FROM leave_requests');
  await pool.query('DELETE FROM carryover_grants');
  await pool.query('UPDATE settings SET min_notice_days = 2, max_team_off = 2, version = 1');
  await pool.query("UPDATE leave_types SET yearly_allowance = 20 WHERE name = 'Annual'");
});

describe('half-day, carry-over, edit and delivery workflows', () => {
  it('books opposite halves, edits a pending request and rejects stale manager decisions', async () => {
    const morning = await api('employee1').post('/requests', { ...leave(), period: 'am' }).expect(201);
    const afternoon = await api('employee1').post('/requests', { ...leave(), period: 'pm' }).expect(201);
    await api('employee1').post('/requests', leave()).expect(409);
    await api('employee1').patch(`/requests/${morning.body.id}`, { ...leave(), period: 'pm', version: 1 }).expect(409);
    await api('employee1').patch(`/requests/${afternoon.body.id}/status`, { status: 'cancelled' }).expect(200);
    const edited = await api('employee1').patch(`/requests/${morning.body.id}`, { ...leave('2026-01-06'), period: 'pm', version: 1 }).expect(200);
    expect(edited.body).toMatchObject({ period: 'pm', version: 2, workingDates: ['2026-01-06'] });
    const preview = await api('employee1').post(`/requests/${morning.body.id}/preview`, { ...leave('2026-01-06'), period: 'pm', version: 2 }).expect(200);
    expect(preview.body.daysByYear).toEqual({ '2026': 0.5 });
    await api('employee2').patch(`/requests/${morning.body.id}`, { ...leave(), version: 2 }).expect(403);
    await api('manager1').patch(`/requests/${morning.body.id}/status`, { status: 'approved', version: 1 }).expect(409);
    await api('manager1').patch(`/requests/${morning.body.id}/status`, { status: 'approved', version: 2 }).expect(200);
    expect((await workspace('employee1')).employees[0].balances.find((item) => item.leaveTypeId === annualId))
      .toMatchObject({ approved: 0.5, pending: 0, remaining: 19.5 });
  });

  it('enforces coverage independently for each half-day', async () => {
    const policy = await configuration();
    policy.settings.maxTeamOff = 1;
    await api('admin').put('/admin/configuration', policy).expect(200);
    await api('employee1').post('/requests', { ...leave(), period: 'am' }).expect(201);
    await api('employee2').post('/requests', { ...leave(), period: 'pm' }).expect(201);
    await api('employee2').post('/requests', { ...leave(), period: 'am' }).expect(409);
  });

  it('grants capped carry-over, spends it first and does not turn expired refunds into base allowance', async () => {
    clockTime = '2027-01-02T10:00:00.000Z';
    const created = await api('employee1').post('/requests', { ...leave('2027-01-04'), period: 'am' }).expect(201);
    expect(created.body.carryoverByYear).toEqual({ '2027': 0.5 });
    const before = await api('employee1').get('/workspace?year=2027').expect(200);
    expect(before.body.employees[0].balances.find((item: { leaveTypeId: string }) => item.leaveTypeId === annualId))
      .toMatchObject({ allowance: 20, carryoverGranted: 5, carryoverRemaining: 4.5, remaining: 24.5 });
    await api('manager1').patch(`/requests/${created.body.id}/status`, { status: 'approved', version: 1 }).expect(200);
    clockTime = '2027-04-01T10:00:00.000Z';
    await api('employee1').patch(`/requests/${created.body.id}/status`, { status: 'cancelled' }).expect(200);
    const after = await api('employee1').get('/workspace?year=2027').expect(200);
    expect(after.body.employees[0].balances.find((item: { leaveTypeId: string }) => item.leaveTypeId === annualId))
      .toMatchObject({ remaining: 20, carryoverExpired: 5, carryoverRemaining: 0 });
  });

  it('freezes carry-over before a previous-year cancellation can inflate it', async () => {
    const previous = await api('employee1').post('/requests', leave('2026-01-05', '2026-01-30')).expect(201);
    expect(previous.body.workingDates).toHaveLength(20);
    clockTime = '2027-01-02T10:00:00.000Z';
    await api('employee1').patch(`/requests/${previous.body.id}/status`, { status: 'cancelled' }).expect(200);
    const current = await api('employee1').get('/workspace?year=2027').expect(200);
    expect(current.body.employees[0].balances.find((item: { leaveTypeId: string }) => item.leaveTypeId === annualId))
      .toMatchObject({ carryoverGranted: 0, remaining: 20 });
  });

  it('deduplicates concurrent reminders and stops after a decision', async () => {
    const created = await api('employee1').post('/requests', leave()).expect(201);
    clockTime = '2026-01-03T11:00:00.000Z';
    const repository = app.get(PgLeaveRepository);
    const runs = await Promise.all([repository.remindPending(), repository.remindPending()]);
    expect(runs.reduce((total, count) => total + count, 0)).toBe(1);
    expect(await repository.remindPending()).toBe(0);
    const feed = await api('manager1').get('/notifications').expect(200);
    expect(feed.body.items.filter((item: { title: string }) => item.title === 'Approval reminder')).toHaveLength(1);
    clockTime = '2026-01-04T11:00:00.000Z';
    expect(await repository.remindPending()).toBe(1);
    await api('manager1').patch(`/requests/${created.body.id}/status`, { status: 'approved', version: 1 }).expect(200);
    clockTime = '2026-01-05T11:00:00.000Z';
    expect(await repository.remindPending()).toBe(0);
  });

  it('queues only committed notifications, retries failed delivery and sends minimal email content', async () => {
    app.get<Environment>(ENVIRONMENT).EMAIL_ENABLED = true;
    await api('employee1').post('/requests', leave()).expect(201);
    await api('employee1').post('/requests', leave()).expect(409);
    expect((await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM email_outbox')).rows[0].count).toBe(1);
    const jobs = app.get(AutomationService);
    mailbox.failNext(new Error('Temporary SMTP failure'));
    expect((await jobs.runOnce()).emails).toBe(0);
    expect((await pool.query('SELECT status, attempts FROM email_outbox')).rows[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await jobs.runOnce()).emails).toBe(0);
    clockTime = '2026-01-01T10:02:00.000Z';
    expect((await jobs.runOnce()).emails).toBe(1);
    const sent = mailbox.assertSent({ to: 'manager1@example.test' });
    expect(sent.subject).toBe('OFFZONE: New leave request');
    expect(sent.text).toContain(origin);
    expect(sent.text).not.toContain('A planned break');
    expect(sent.attachments).toHaveLength(0);
    expect((await jobs.runOnce()).emails).toBe(0);
    expect((await pool.query('SELECT status, attempts FROM email_outbox')).rows[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('retains exhausted deliveries as failures and skips recipients who were deactivated', async () => {
    app.get<Environment>(ENVIRONMENT).EMAIL_ENABLED = true;
    await api('employee1').post('/requests', leave()).expect(201);
    const jobs = app.get(AutomationService);
    await pool.query('UPDATE email_outbox SET attempts = 4');
    mailbox.failNext(new Error('SMTP unavailable'));
    expect((await jobs.runOnce()).emails).toBe(0);
    expect((await pool.query('SELECT status, attempts FROM email_outbox')).rows[0]).toMatchObject({ status: 'failed', attempts: 5 });
    expect((await workspace()).automation).toMatchObject({ queuedEmails: 0, failedEmails: 1 });
    await pool.query("UPDATE email_outbox SET status = 'sending', leased_until = $1", ['2026-01-01T09:00:00Z']);
    await jobs.runOnce();
    expect((await pool.query('SELECT status, error_code FROM email_outbox')).rows[0])
      .toMatchObject({ status: 'failed', error_code: 'DELIVERY_LEASE_EXPIRED' });
    await pool.query("UPDATE email_outbox SET status = 'pending', attempts = 0, next_attempt_at = $1", [clockTime]);
    mailbox.failNext(new MailMessageError('to', 'Rejected test recipient'));
    await jobs.runOnce();
    expect((await pool.query('SELECT status, attempts FROM email_outbox')).rows[0]).toMatchObject({ status: 'failed', attempts: 1 });
    await pool.query('DELETE FROM email_outbox');
    await api('employee1').post('/requests', leave('2026-01-06')).expect(201);
    try {
      await pool.query("UPDATE users SET is_active = false WHERE email = 'manager1@example.test'");
      expect((await jobs.runOnce()).emails).toBe(0);
      expect((await pool.query('SELECT status, error_code FROM email_outbox')).rows[0])
        .toMatchObject({ status: 'skipped', error_code: 'INACTIVE_RECIPIENT' });
    } finally { await pool.query("UPDATE users SET is_active = true WHERE email = 'manager1@example.test'"); }
  });

  it('delivers over a local SMTP double and rejects plaintext when TLS is required', async () => {
    const messages: string[] = [];
    const clients = new Set<Socket>();
    const smtp = createServer((socket) => {
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));
      socket.setEncoding('utf8');
      socket.write('220 localhost SMTP test\r\n');
      let buffer = '';
      let receiving = false;
      let message: string[] = [];
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        while (buffer.includes('\r\n')) {
          const end = buffer.indexOf('\r\n');
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (receiving) {
            if (line === '.') {
              receiving = false;
              messages.push(message.join('\r\n'));
              message = [];
              socket.write('250 Message accepted\r\n');
            } else message.push(line.startsWith('..') ? line.slice(1) : line);
          } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
          else if (/^(MAIL FROM|RCPT TO|RSET|NOOP)/i.test(line)) socket.write('250 OK\r\n');
          else if (line === 'DATA') { receiving = true; socket.write('354 Send message\r\n'); }
          else if (line === 'QUIT') socket.end('221 Bye\r\n');
          else socket.write('500 Unsupported test command\r\n');
        }
      });
    });
    await new Promise<void>((resolve, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', resolve); });
    const address = smtp.address();
    if (!address || typeof address === 'string') throw new Error('SMTP double did not bind a local port.');
    try {
      for (const requireTls of [false, true]) {
        const environment = { ...app.get<Environment>(ENVIRONMENT), EMAIL_ENABLED: true, SMTP_FROM: 'offzone@example.test',
          SMTP_URL: `smtp://127.0.0.1:${address.port}`, SMTP_REQUIRE_TLS: requireTls };
        const module = await Test.createTestingModule({
          imports: [MailModule.forRoot(mailOptions(environment))],
          providers: [NotificationEmail, { provide: ENVIRONMENT, useValue: environment }],
        }).compile();
        try {
          const delivery = module.get(NotificationEmail).send('smtp-verification', 'manager@example.test', 'Approval reminder');
          if (requireTls) await expect(delivery).rejects.toThrow(/STARTTLS|TLS/i);
          else await expect(delivery).resolves.toMatchObject({ accepted: ['manager@example.test'], attempts: 1 });
        } finally { await module.close(); }
      }
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Subject: OFFZONE: Approval reminder');
      expect(messages[0]).toContain('This email does not include leave reasons');
    } finally {
      for (const socket of clients) socket.destroy();
      await new Promise<void>((resolve, reject) => smtp.close((error) => error ? reject(error) : resolve()));
    }
  });
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (adminPool) {
    // Only the uniquely generated test schema is removed; public/demo data is never touched.
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  }
  vi.unstubAllEnvs();
});

describe('authenticated API against isolated PostgreSQL', () => {
  it('advertises disabled demo access and refuses demo sign-in unless explicitly enabled', async () => {
    await api().get('/auth/options').expect(200, { demoLoginEnabled: false });
    const denied = await api().post('/auth/demo-login', { role: 'admin' }).expect(403);
    expect(denied.body.message).toContain('Demo sign-in is disabled');
    expect(denied.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['employee', 'employee1@example.test', 1],
    ['manager', 'manager1@example.test', 4],
    ['admin', 'admin@example.test', 8],
  ] as const)('opens only the seeded %s portal and retains its server permissions', async (role, email, visibleEmployees) => {
    app.get<Environment>(ENVIRONMENT).DEMO_LOGIN_ENABLED = true;
    await api().get('/auth/options').expect(200, { demoLoginEnabled: true });
    const result = await api().post('/auth/demo-login', { role }).expect(200);
    expect(result.body).toMatchObject({ role, email });
    expect(result.body).not.toHaveProperty('passwordHash');
    expect(result.body).not.toHaveProperty('token');
    const cookie = setCookieHeaders(result)[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const demoCookie = cookie.split(';')[0];
    const view = await request(server).get('/api/workspace?year=2026').set('Cookie', demoCookie).expect(200);
    expect(view.body.employees).toHaveLength(visibleEmployees);
    if (role !== 'admin') {
      await request(server).post('/api/admin/leave-types').set('Origin', origin).set('Cookie', demoCookie)
        .send({ name: 'Not allowed', yearlyAllowance: 1 }).expect(403);
    }
    if (role !== 'employee') {
      await request(server).post('/api/requests').set('Origin', origin).set('Cookie', demoCookie).send(leave()).expect(403);
    }
  });

  it('rejects invalid demo roles and attempts to choose arbitrary accounts', async () => {
    app.get<Environment>(ENVIRONMENT).DEMO_LOGIN_ENABLED = true;
    await api().post('/auth/demo-login', { role: 'superadmin' }).expect(400);
    await api().post('/auth/demo-login', { role: 'employee', email: 'employee5@example.test', password: 'anything' }).expect(400);
  });

  it('invalidates existing demo sessions when demo mode is disabled without breaking account sessions', async () => {
    const environment = app.get<Environment>(ENVIRONMENT);
    environment.DEMO_LOGIN_ENABLED = true;
    const demo = await api().post('/auth/demo-login', { role: 'employee' }).expect(200);
    const cookie = setCookieHeaders(demo)[0].split(';')[0];
    await request(server).get('/api/auth/me').set('Cookie', cookie).expect(200);
    environment.DEMO_LOGIN_ENABLED = false;
    await request(server).get('/api/auth/me').set('Cookie', cookie).expect(401);
    await api('employee1').get('/auth/me').expect(200);
  });

  it('fails explicitly when a fixed demo account is unavailable instead of selecting another user', async () => {
    app.get<Environment>(ENVIRONMENT).DEMO_LOGIN_ENABLED = true;
    await pool.query("UPDATE users SET email = 'renamed@example.test' WHERE email = 'employee1@example.test'");
    try {
      const response = await api().post('/auth/demo-login', { role: 'employee' }).expect(503);
      expect(response.body.message).toContain('seeded demo account');
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      await pool.query("UPDATE users SET email = 'employee1@example.test' WHERE email = 'renamed@example.test'");
    }
  });

  it('serves health without a session and protects workspace data', async () => {
    await api().get('/health').expect(200, { status: 'ok' });
    await api().get('/workspace').expect(401);
    const me = await api('employee1').get('/auth/me').expect(200);
    expect(me.body).toMatchObject({ role: 'employee', email: 'employee1@example.test' });
  });

  it('rejects invalid credentials without disclosing whether an account exists', async () => {
    const response = await api().post('/auth/login', { email: 'missing@example.test', password: 'incorrect' }).expect(401);
    const wrongPassword = await api().post('/auth/login', { email: 'employee1@example.test', password: 'incorrect' }).expect(401);
    expect(response.body.message).toBe('Email or password is incorrect.');
    expect(wrongPassword.body.message).toBe(response.body.message);
  });

  it('rejects cross-origin mutations, malformed dates, unknown fields, and invalid IDs', async () => {
    await request(server).post('/api/requests').set('Origin', 'https://other.example.test').set('Cookie', cookies.get('employee1')!).send(leave()).expect(403);
    await api('employee1').post('/requests', { ...leave(), startDate: '2026-02-30' }).expect(400);
    await api('employee1').post('/requests', { ...leave(), employeeId: randomUUID() }).expect(400);
    await api('employee1').patch('/requests/not-a-uuid/status', { status: 'cancelled' }).expect(400);
    await api('employee1').get('/workspace?year=invalid').expect(400);
  });

  it('reserves pending days and restores approved days when cancelled', async () => {
    const created = await api('employee1').post('/requests', leave('2026-01-05', '2026-01-06')).expect(201);
    const saved: LeaveRequest = created.body;
    expect((await workspace('employee1')).employees[0].balances.find((balance) => balance.leaveTypeId === annualId))
      .toMatchObject({ pending: 2, approved: 0, remaining: 18 });
    await api('manager1').patch(`/requests/${saved.id}/status`, { status: 'approved', note: 'Approved' }).expect(200);
    expect((await workspace('employee1')).employees[0].balances.find((balance) => balance.leaveTypeId === annualId))
      .toMatchObject({ pending: 0, approved: 2, remaining: 18 });
    await api('employee1').patch(`/requests/${saved.id}/status`, { status: 'cancelled' }).expect(200);
    expect((await workspace('employee1')).employees[0].balances.find((balance) => balance.leaveTypeId === annualId)?.remaining).toBe(20);
    await api('employee1').post('/requests', leave('2026-01-05', '2026-01-06')).expect(201);
  });

  it('previews working days without persisting and excludes holidays and weekends', async () => {
    const result = await api('employee1').post('/requests/preview', leave('2026-03-19', '2026-03-23')).expect(200);
    expect(result.body).toEqual({ workingDates: ['2026-03-19', '2026-03-23'], daysByYear: { '2026': 2 } });
    expect((await workspace('employee1')).requests).toHaveLength(0);
    await api('employee1').post('/requests', leave('2026-01-10', '2026-01-11')).expect(400);
    await api('employee1').post('/requests', leave('2026-01-06', '2026-01-05')).expect(400);
  });

  it('enforces owner, report, and admin permissions on the server', async () => {
    await api('manager1').post('/requests', leave()).expect(403);
    const created = await api('employee1').post('/requests', leave()).expect(201);
    for (const actor of ['employee1', 'manager2', 'admin']) {
      await api(actor).patch(`/requests/${created.body.id}/status`, { status: 'approved' }).expect(403);
    }
    await api('employee2').patch(`/requests/${created.body.id}/status`, { status: 'cancelled' }).expect(403);
    await api('manager1').patch(`/requests/${created.body.id}/status`, { status: 'rejected' }).expect(200);
    await api('manager1').patch(`/requests/${created.body.id}/status`, { status: 'approved' }).expect(409);
    await api('manager1').patch(`/requests/${randomUUID()}/status`, { status: 'approved' }).expect(404);
    await api('employee1').put('/admin/configuration', await configuration()).expect(403);
    await api('manager1').post('/admin/leave-types', { name: 'Special', yearlyAllowance: 2 }).expect(403);
  });

  it('limits employee balance visibility and removes reasons from the shared team calendar', async () => {
    await api('employee1').post('/requests', leave()).expect(201);
    await api('employee5').post('/requests', leave()).expect(201);
    const employeeView = await workspace('employee2');
    expect(employeeView.employees).toHaveLength(1);
    expect(employeeView.requests).toHaveLength(0);
    expect(employeeView.calendar).toHaveLength(1);
    expect(employeeView.calendar[0]).not.toHaveProperty('reason');
    expect((await workspace('manager1')).employees).toHaveLength(4);
    expect((await workspace('manager1')).requests).toHaveLength(1);
    expect((await workspace()).employees).toHaveLength(8);
  });

  it('serializes competing submissions for the final team slot', async () => {
    const config = await configuration();
    config.settings.maxTeamOff = 1;
    await api('admin').put('/admin/configuration', config).expect(200);
    const responses = await Promise.all(['employee1', 'employee2'].map((actor) => api(actor).post('/requests', leave())));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await workspace('manager1')).requests).toHaveLength(1);
  });

  it('serializes competing requests for the same remaining balance', async () => {
    const config = await configuration();
    config.leaveTypes.find((type) => type.id === annualId)!.yearlyAllowance = 1;
    await api('admin').put('/admin/configuration', config).expect(200);
    const responses = await Promise.all([
      api('employee1').post('/requests', leave('2026-01-05')),
      api('employee1').post('/requests', leave('2026-01-06')),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it('enforces pending overlap and counts cross-year reservations per year', async () => {
    await api('employee1').post('/requests', leave('2026-01-05', '2026-01-07')).expect(201);
    await api('employee1').post('/requests', leave('2026-01-07', '2026-01-08')).expect(409);
    await api('employee2').post('/requests', leave('2026-12-31', '2027-01-04')).expect(201);
    const current = await workspace('employee2');
    const next = await api('employee2').get('/workspace?year=2027').expect(200);
    expect(current.employees[0].balances.find((balance) => balance.leaveTypeId === annualId)?.pending).toBe(1);
    const nextWorkspace: Workspace = next.body;
    expect(nextWorkspace.employees[0].balances.find((balance) => balance.leaveTypeId === annualId)?.pending).toBe(1);
  });

  it('applies edited notice, allowance, and coverage immediately; rejects stale configuration', async () => {
    const original = await configuration();
    const updated = structuredClone(original);
    updated.settings.minNoticeDays = 10;
    updated.settings.maxTeamOff = 1;
    updated.leaveTypes.find((type) => type.id === annualId)!.yearlyAllowance = 1;
    await api('admin').put('/admin/configuration', updated).expect(200);
    await api('admin').put('/admin/configuration', original).expect(409);
    await api('employee1').post('/requests', leave('2026-01-05')).expect(400);
    await api('employee1').post('/requests', leave('2026-01-12', '2026-01-13')).expect(409);
    await api('employee1').post('/requests', leave('2026-01-12')).expect(201);
    await api('employee2').post('/requests', leave('2026-01-12')).expect(409);
  });

  it('keeps charged dates stable when holidays change but uses the new holiday for new requests', async () => {
    const created = await api('employee1').post('/requests', leave()).expect(201);
    const config = await configuration();
    config.holidays.push({ date: '2026-01-05', name: 'New holiday' });
    await api('admin').put('/admin/configuration', config).expect(200);
    const stored = (await workspace('employee1')).requests.find((item) => item.id === created.body.id);
    expect(stored?.workingDates).toEqual(['2026-01-05']);
    await api('employee2').post('/requests', leave()).expect(400);
    await pool.query("DELETE FROM holidays WHERE date = '2026-01-05'");
  });

  it('creates configurable leave types and handles duplicate names without leaking SQL', async () => {
    await api('admin').post('/admin/leave-types', { name: 'Compassionate', yearlyAllowance: 5 }).expect(201);
    const duplicate = await api('admin').post('/admin/leave-types', { name: 'compassionate', yearlyAllowance: 5 }).expect(409);
    expect(duplicate.body.message).toBe('That name or record already exists.');
    const config = await configuration();
    config.leaveTypes = config.leaveTypes.filter((type) => type.id !== annualId);
    await api('admin').put('/admin/configuration', config).expect(400);
  });

  it('rejects tampered, invalid-subject, and deleted-account tokens', async () => {
    const jwt = app.get(JwtService);
    for (const token of ['tampered', await jwt.signAsync({ sub: 'not-a-uuid' }), await jwt.signAsync({ sub: randomUUID() })]) {
      await request(server).get('/api/auth/me').set('Cookie', `leave_session=${token}`).expect(401);
    }
  });

  it('clears the browser session cookie on sign-out', async () => {
    const result = await api('employee1').post('/auth/logout', {}).expect(200);
    const setCookies = setCookieHeaders(result);
    expect(setCookies[0]).toContain('leave_session=;');
    expect(setCookies[0]).toContain('HttpOnly');
  });
});
