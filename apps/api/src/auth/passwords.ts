import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

@Injectable()
export class Passwords {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const key = await derive(password, salt);
    return `scrypt$${salt}$${key.toString('hex')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
    if (!match) throw new Error('Invalid stored password-hash format.');
    const actual = await derive(password, match[1]);
    return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
  }
}
