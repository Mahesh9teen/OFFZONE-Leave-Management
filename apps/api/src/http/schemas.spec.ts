import { configurationSchema, loginSchema, requestSchema, transitionSchema, yearSchema } from './schemas.js';
import { readEnvironment } from '../config.js';

const typeId = '00000000-0000-4000-8000-000000000001';

describe('HTTP boundary validation', () => {
  it('rejects actor spoofing and whitespace-only reasons', () => {
    const input = { leaveTypeId: typeId, startDate: '2026-02-02', endDate: '2026-02-03', reason: 'Holiday' };
    expect(requestSchema.safeParse({ ...input, employeeId: typeId }).success).toBe(false);
    expect(requestSchema.safeParse({ ...input, reason: '   ' }).success).toBe(false);
    expect(requestSchema.safeParse({ ...input, startDate: '2026-02-30' }).success).toBe(false);
  });

  it('rejects invalid roles, statuses, years, and login bodies', () => {
    expect(transitionSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(yearSchema.safeParse({ year: 'nope' }).success).toBe(false);
    expect(yearSchema.safeParse({ year: '2101' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'not-an-email', password: '' }).success).toBe(false);
  });

  it('rejects duplicate type IDs, case-insensitive names, and holiday dates', () => {
    const type = { id: typeId, name: 'Annual', yearlyAllowance: 20 };
    const holiday = { date: '2026-01-01', name: 'New Year' };
    const invalid = {
      settings: { minNoticeDays: 2, maxTeamOff: 2, version: 1 },
      leaveTypes: [type, { ...type, name: 'ANNUAL' }],
      holidays: [holiday, holiday],
    };
    const result = configurationSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(3);
  });

  it('rejects unsafe settings rather than silently defaulting', () => {
    const result = configurationSchema.safeParse({
      settings: { minNoticeDays: -1, maxTeamOff: 0, version: 1 },
      leaveTypes: [{ id: typeId, name: 'Annual', yearlyAllowance: -1 }],
      holidays: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('environment configuration', () => {
  const valid = {
    DATABASE_URL: 'postgresql://localhost/test',
    AUTH_SECRET: 'test-only-secret'.repeat(3),
    APP_ORIGIN: 'http://localhost:4200',
  };

  it('parses valid config with secure cookies by default', () => {
    expect(readEnvironment(valid)).toMatchObject({ COOKIE_SECURE: true, PORT: 3001, DEMO_LOGIN_ENABLED: false });
    expect(readEnvironment({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('requires an explicit opt-in for password-free demo access', () => {
    expect(readEnvironment({ ...valid, DEMO_LOGIN_ENABLED: 'true' })).toMatchObject({ DEMO_LOGIN_ENABLED: true });
    expect(() => readEnvironment({ ...valid, DEMO_LOGIN_ENABLED: 'yes' })).toThrow(/DEMO_LOGIN_ENABLED/);
  });

  it.each([
    { DATABASE_URL: 'https://example.test' },
    { AUTH_SECRET: 'short' },
    { APP_ORIGIN: 'http://localhost:4200/path' },
    { PORT: '0' },
  ])('reports invalid configuration fields explicitly', (override) => {
    expect(() => readEnvironment({ ...valid, ...override })).toThrow(/Invalid configuration/);
  });

  it('requires encrypted SMTP outside localhost in production', () => {
    expect(() => readEnvironment({ ...valid, NODE_ENV: 'production', EMAIL_ENABLED: 'true', SMTP_URL: 'smtp://mail.example.test:587',
      SMTP_FROM: 'offzone@example.test', SMTP_REQUIRE_TLS: 'false' })).toThrow(/TLS/);
  });
});
