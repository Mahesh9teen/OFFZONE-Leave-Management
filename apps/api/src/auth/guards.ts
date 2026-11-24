import {
  createParamDecorator, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException,
  type CanActivate, type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Role, User } from '@leave/contracts';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './cookies.js';
import { ENVIRONMENT, type Environment } from '../config.js';

export const Public = () => SetMetadata('public', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export type AuthenticatedRequest = Request & { user?: User; demoSession?: boolean };
const sessionSchema = z.object({
  sub: z.uuid(),
  demo: z.boolean().default(false),
  // Existing pre-upgrade sessions belong to version zero.
  version: z.number().int().min(0).default(0),
});
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new UnauthorizedException('Please sign in.');
  return user;
});

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== this.environment.APP_ORIGIN) {
      throw new ForbiddenException('This request must come from the configured application origin.');
    }
    return true;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies: unknown = request.cookies;
    const parsed = z.object({ [SESSION_COOKIE]: z.string() }).safeParse(cookies);
    if (!parsed.success) throw new UnauthorizedException('Please sign in.');

    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<typeof claims>(parsed.data[SESSION_COOKIE]);
    } catch {
      throw new UnauthorizedException('Your session expired or is invalid. Please sign in again.');
    }
    const session = sessionSchema.safeParse(claims);
    if (!session.success) throw new UnauthorizedException('Invalid session.');
    if (session.data.demo && !this.environment.DEMO_LOGIN_ENABLED) {
      throw new UnauthorizedException('Demo access is disabled. Please sign in with your account credentials.');
    }
    const user = await this.auth.findUser(session.data.sub, session.data.version);
    if (!user) throw new UnauthorizedException('Your account is no longer available.');
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('You do not have permission for this action.');
    request.user = user;
    request.demoSession = session.data.demo;
    return true;
  }
}
