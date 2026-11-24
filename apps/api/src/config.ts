import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value), 'Must be a PostgreSQL URL'),
  AUTH_SECRET: z.string().min(32),
  APP_ORIGIN: z.url().refine((value) => new URL(value).origin === value, 'Use an origin without a trailing slash or path'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  DEMO_LOGIN_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  EMAIL_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SMTP_URL: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  SMTP_REQUIRE_TLS: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  JOBS_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  JOBS_POLL_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).superRefine((value, context) => {
  if (!value.EMAIL_ENABLED) return;
  const validUrl = URL.canParse(value.SMTP_URL) && ['smtp:', 'smtps:'].includes(new URL(value.SMTP_URL).protocol);
  if (!validUrl) context.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'Configure an smtp:// or smtps:// server URL before enabling email.' });
  if (!z.email().safeParse(value.SMTP_FROM).success) context.addIssue({ code: 'custom', path: ['SMTP_FROM'], message: 'Configure a valid sender email address.' });
  if (validUrl && !value.SMTP_REQUIRE_TLS && value.NODE_ENV === 'production'
    && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value.SMTP_URL).hostname)) {
    context.addIssue({ code: 'custom', path: ['SMTP_REQUIRE_TLS'], message: 'Production SMTP must use TLS outside localhost.' });
  }
}).transform((value) => ({ ...value, JOBS_ENABLED: value.JOBS_ENABLED ?? value.NODE_ENV !== 'test' }));

export type Environment = z.infer<typeof environmentSchema>;
export const ENVIRONMENT = Symbol('ENVIRONMENT');

export function readEnvironment(source: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return result.data;
}
