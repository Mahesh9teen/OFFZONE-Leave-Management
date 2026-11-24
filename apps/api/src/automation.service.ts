import { Inject, Injectable, Logger, ServiceUnavailableException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { MailError } from '@nestjs/mail';
import { ENVIRONMENT, type Environment } from './config.js';
import { Database } from './db/database.js';
import { PgLeaveRepository } from './db/leave.repository.js';
import { NotificationEmail } from './mail.service.js';
import { Clock } from './clock.js';

interface Delivery {
  id: string;
  attempts: number;
  email: string;
  title: string;
  active: boolean;
}

@Injectable()
export class AutomationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AutomationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<{ reminders: number; emails: number }>;
  private stopping = false;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PgLeaveRepository) private readonly repository: PgLeaveRepository,
    @Inject(NotificationEmail) private readonly email: NotificationEmail,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (!this.environment.JOBS_ENABLED) {
      this.logger.log('Scheduled leave jobs are disabled.');
      return;
    }
    const tick = () => {
      if (this.running) return;
      void this.runOnce().catch((error: unknown) => this.logger.error(
        `Scheduled leave jobs failed: ${error instanceof Error ? error.name : 'UnknownError'}.`,
      ));
    };
    tick();
    this.timer = setInterval(tick, this.environment.JOBS_POLL_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    try { if (this.running) await this.running; }
    catch (error) { this.logger.error(`A leave job failed during shutdown (${error instanceof Error ? error.name : 'UnknownError'}).`); }
  }

  runOnce(): Promise<{ reminders: number; emails: number }> {
    if (this.stopping) return Promise.reject(new ServiceUnavailableException('Scheduled jobs are stopping.'));
    if (this.running) return this.running;
    this.running = this.work().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async work() {
    const now = this.clock.now().toISOString();
    await this.repository.ensureCarryover(now.slice(0, 10));
    const reminders = await this.repository.remindPending(now);
    const emails = this.environment.EMAIL_ENABLED && !this.stopping ? await this.deliverEmails(now) : 0;
    return { reminders, emails };
  }

  private async deliverEmails(now: string): Promise<number> {
    const expired = await this.db.pool.query(`UPDATE email_outbox SET status = 'failed', error_code = 'DELIVERY_LEASE_EXPIRED', leased_until = NULL
      WHERE status = 'sending' AND attempts >= 5 AND leased_until <= $1::timestamptz`, [now]);
    if (expired.rowCount) this.logger.error(`${expired.rowCount} email delivery leases expired after the final attempt.`);
    let sent = 0;
    for (let index = 0; index < 10 && !this.stopping; index++) {
      const job = await this.db.transaction(async (client) => {
        const result = await client.query<Delivery>(`
        WITH due AS (
          SELECT o.id FROM email_outbox o JOIN notifications n ON n.id = o.notification_id
          WHERE o.attempts < 5 AND o.next_attempt_at <= $1::timestamptz
            AND (o.status = 'pending' OR (o.status = 'sending' AND o.leased_until <= $1::timestamptz))
          ORDER BY o.next_attempt_at, n.event_sequence LIMIT 1 FOR UPDATE OF o SKIP LOCKED
        ), claimed AS (
          UPDATE email_outbox o SET status = 'sending', attempts = attempts + 1,
            leased_until = $1::timestamptz + interval '2 minutes'
          FROM due WHERE o.id = due.id RETURNING o.id, o.attempts, o.notification_id
        )
        SELECT c.id, c.attempts, u.email, u.is_active AS active, n.title
        FROM claimed c JOIN notifications n ON n.id = c.notification_id JOIN users u ON u.id = n.recipient_id`, [this.clock.now().toISOString()]);
        return result.rows[0];
      });
      if (!job) break;
      if (!job.active) {
        await this.db.pool.query("UPDATE email_outbox SET status = 'skipped', error_code = 'INACTIVE_RECIPIENT', leased_until = NULL WHERE id = $1 AND status = 'sending' AND attempts = $2", [job.id, job.attempts]);
        continue;
      }
      try {
        await this.email.send(job.id, job.email, job.title);
        const saved = await this.db.pool.query("UPDATE email_outbox SET status = 'sent', sent_at = $2, leased_until = NULL, error_code = '' WHERE id = $1 AND status = 'sending' AND attempts = $3",
          [job.id, this.clock.now().toISOString(), job.attempts]);
        if (saved.rowCount) sent++;
        else this.logger.warn(`Email ${job.id} completed after its delivery lease changed.`);
      } catch (error) {
        const failed = job.attempts >= 5 || (error instanceof MailError && error.permanent);
        const next = new Date(this.clock.now().getTime() + Math.min(3600000, 60000 * 2 ** (job.attempts - 1))).toISOString();
        const code = error instanceof Error ? error.name.slice(0, 100) : 'UnknownDeliveryError';
        await this.db.pool.query("UPDATE email_outbox SET status = $2, next_attempt_at = $3, leased_until = NULL, error_code = $4 WHERE id = $1 AND status = 'sending' AND attempts = $5",
          [job.id, failed ? 'failed' : 'pending', next, code, job.attempts]);
        this.logger.error(`Email ${job.id} ${failed ? 'failed permanently' : 'will be retried'} (${code}).`);
      }
    }
    return sent;
  }
}
