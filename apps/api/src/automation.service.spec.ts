import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AutomationService } from './automation.service.js';
import { Database } from './db/database.js';
import { PgLeaveRepository } from './db/leave.repository.js';
import { NotificationEmail } from './mail.service.js';
import { Clock } from './clock.js';
import { ENVIRONMENT, readEnvironment } from './config.js';

async function harness(scheduled = false) {
  const repository = { ensureCarryover: vi.fn().mockResolvedValue(undefined), remindPending: vi.fn().mockResolvedValue(2) };
  const environment = readEnvironment({
    DATABASE_URL: 'postgresql://localhost/test', AUTH_SECRET: 'test-only-secret'.repeat(3),
    APP_ORIGIN: 'http://localhost:4200', NODE_ENV: 'test', JOBS_ENABLED: String(scheduled), JOBS_POLL_MS: '1000',
  });
  const module = await Test.createTestingModule({
    providers: [AutomationService, { provide: Database, useValue: {} }, { provide: PgLeaveRepository, useValue: repository },
      { provide: NotificationEmail, useValue: {} }, { provide: ENVIRONMENT, useValue: environment },
      { provide: Clock, useValue: { now: () => new Date('2027-01-02T10:00:00Z') } }],
  }).compile();
  return { module, repository, jobs: module.get(AutomationService) };
}

describe('scheduled leave jobs', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('coalesces overlapping cycles and permits a retry after failure', async () => {
    const { module, jobs, repository } = await harness();
    try {
      let complete!: (count: number) => void;
      repository.remindPending.mockImplementationOnce(() => new Promise<number>((resolve) => { complete = resolve; }));
      const first = jobs.runOnce();
      const second = jobs.runOnce();
      expect(second).toBe(first);
      await Promise.resolve();
      complete(2);
      await expect(first).resolves.toEqual({ reminders: 2, emails: 0 });
      expect(repository.ensureCarryover).toHaveBeenCalledOnce();
      repository.ensureCarryover.mockRejectedValueOnce(new Error('Database unavailable'));
      await expect(jobs.runOnce()).rejects.toThrow('Database unavailable');
      await expect(jobs.runOnce()).resolves.toEqual({ reminders: 2, emails: 0 });
    } finally { await module.close(); }
  });

  it('runs enabled timers, reports failures and stops cleanly', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { module, jobs, repository } = await harness(true);
    repository.ensureCarryover.mockRejectedValueOnce(new Error('Unavailable'));
    jobs.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(repository.remindPending).toHaveBeenCalledOnce();
    await module.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(repository.remindPending).toHaveBeenCalledOnce();
    await expect(jobs.runOnce()).rejects.toThrow(/stopping/);
  });

  it('does not schedule timers when jobs are disabled', async () => {
    const { module, jobs, repository } = await harness();
    jobs.onApplicationBootstrap();
    expect(repository.ensureCarryover).not.toHaveBeenCalled();
    await module.close();
  });
});
