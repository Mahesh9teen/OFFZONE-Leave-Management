import { NotificationEmail, mailOptions } from './mail.service.js';
import { readEnvironment } from './config.js';
import { Test } from '@nestjs/testing';
import { Mailer, MailModule } from '@nestjs/mail';

const environment = () => readEnvironment({
  DATABASE_URL: 'postgresql://localhost/test',
  AUTH_SECRET: 'test-only-secret'.repeat(3),
  APP_ORIGIN: 'http://localhost:4200',
  NODE_ENV: 'test',
  EMAIL_ENABLED: 'true',
  SMTP_URL: 'smtp://localhost:1025',
  SMTP_FROM: 'offzone@example.test',
});

describe('optional email notifications', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a minimal workspace notification with a stable retry identity', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const mailer = { send: vi.fn().mockResolvedValue({ messageId: 'test', accepted: ['manager@example.test'], attempts: 1 }) };
    const service = new NotificationEmail(mailer, environment());
    await service.send('outbox-1', 'manager@example.test', 'Approval reminder');
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'manager@example.test', subject: 'OFFZONE: Approval reminder', idempotencyKey: 'outbox-1', retry: false,
      text: expect.stringContaining('http://localhost:4200/'),
    }));
    expect(mailer.send.mock.calls[0][0]).not.toHaveProperty('attachments');
  });

  it('explicitly refuses delivery when email is disabled', () => {
    const mailer = { send: vi.fn() };
    const config = { ...environment(), EMAIL_ENABLED: false };
    expect(() => new NotificationEmail(mailer, config).send('outbox-1', 'manager@example.test', 'Update')).toThrow(/disabled/i);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(mailOptions(config).transport).toBeDefined();
  });

  it('rejects incomplete SMTP configuration and defaults scheduled jobs off in tests', () => {
    const config = environment();
    expect(config.JOBS_ENABLED).toBe(false);
    expect(() => readEnvironment({
      DATABASE_URL: config.DATABASE_URL, AUTH_SECRET: config.AUTH_SECRET, APP_ORIGIN: config.APP_ORIGIN, EMAIL_ENABLED: 'true',
    })).toThrow(/SMTP_URL|SMTP_FROM/);
  });

  it('does not silently send or write mail through the disabled module transport', async () => {
    const module = await Test.createTestingModule({
      imports: [MailModule.forRoot(mailOptions({ ...environment(), EMAIL_ENABLED: false }))],
    }).compile();
    try {
      await expect(module.get(Mailer).send({ to: 'manager@example.test', subject: 'Update', text: 'Test message', retry: false }))
        .rejects.toThrow(/disabled/);
    } finally { await module.close(); }
  });
});
