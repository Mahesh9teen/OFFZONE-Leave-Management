import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Mailer, MailTransport, SmtpTransport, type MailModuleOptions } from '@nestjs/mail';
import { ENVIRONMENT, type Environment } from './config.js';

class DisabledMailTransport extends MailTransport {
  async send(): Promise<never> { throw new ServiceUnavailableException('Email delivery is disabled. Configure SMTP before enabling it.'); }
}

export function mailOptions(environment: Environment): MailModuleOptions {
  return {
    from: { name: 'OFFZONE', address: environment.SMTP_FROM || 'no-reply@example.test' },
    retry: false,
    transport: environment.EMAIL_ENABLED
      ? new SmtpTransport({
        url: environment.SMTP_URL,
        startTls: environment.SMTP_REQUIRE_TLS ? 'required' : 'never',
        timeouts: { connect: '10s', greeting: '10s', command: '10s', data: '15s' },
      })
      : new DisabledMailTransport(),
  };
}

@Injectable()
export class NotificationEmail {
  constructor(
    @Inject(Mailer) private readonly mailer: Pick<Mailer, 'send'>,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  send(id: string, to: string, title: string) {
    if (!this.environment.EMAIL_ENABLED) throw new ServiceUnavailableException('Email delivery is disabled.');
    return this.mailer.send({
      to, subject: `OFFZONE: ${title}`,
      text: `There is a new update in your leave workspace. Sign in to review your notifications and leave requests:\n${this.environment.APP_ORIGIN}/\n\nThis email does not include leave reasons or attachments.`,
      idempotencyKey: id, retry: false, signal: AbortSignal.timeout(45000),
    });
  }
}
