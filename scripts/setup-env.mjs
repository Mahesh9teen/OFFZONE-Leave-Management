import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, '.env');

if (existsSync(target)) {
  console.log('.env already exists; no credentials or settings were overwritten.');
} else {
  const password = randomBytes(24).toString('hex');
  const values = {
    POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgresql://leave_user:${password}@127.0.0.1:55432/leave_management`,
    AUTH_SECRET: randomBytes(48).toString('hex'),
    SEED_PASSWORD: randomBytes(18).toString('base64url'),
  };
  const template = readFileSync(resolve(root, '.env.example'), 'utf8');
  const content = Object.entries(values).reduce(
    (text, [key, value]) => text.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${value}`),
    template,
  );
  writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with unique local credentials. The demo sign-in password is SEED_PASSWORD in .env.');
}
