import type { Response } from 'express';
import type { Environment } from '../config.js';

export const SESSION_COOKIE = 'leave_session';

export function sessionCookieOptions(environment: Environment) {
  return { httpOnly: true, secure: environment.COOKIE_SECURE, sameSite: 'strict' as const, path: '/api' };
}

export function setSessionCookie(response: Response, token: string, environment: Environment) {
  response.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(environment), maxAge: 8 * 60 * 60 * 1000 });
}
