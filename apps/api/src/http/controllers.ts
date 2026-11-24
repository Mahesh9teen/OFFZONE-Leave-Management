import {
  Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthOptions, ConfigurationInput, CreateRequestInput, EditRequestInput, LeaveType, User } from '@leave/contracts';
import type { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser, Public, Roles } from '../auth/guards.js';
import { SESSION_COOKIE, sessionCookieOptions, setSessionCookie } from '../auth/cookies.js';
import { ENVIRONMENT, type Environment } from '../config.js';
import { Database } from '../db/database.js';
import { LeaveService } from '../leave.service.js';
import { configurationSchema, demoLoginSchema, editRequestSchema, leaveTypeSchema, loginSchema, requestSchema, transitionSchema, yearSchema } from './schemas.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  @Public()
  @Get('options')
  options(): AuthOptions {
    return { demoLoginEnabled: this.environment.DEMO_LOGIN_ENABLED };
  }

  @Public()
  @Post('demo-login')
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  async demoLogin(@Body({ schema: demoLoginSchema }) input: z.infer<typeof demoLoginSchema>, @Res({ passthrough: true }) response: Response) {
    return this.startSession(await this.auth.demoLogin(input.role), response);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  async login(@Body({ schema: loginSchema }) input: z.infer<typeof loginSchema>, @Res({ passthrough: true }) response: Response) {
    return this.startSession(await this.auth.login(input.email, input.password), response);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.environment));
    return { message: 'Signed out.' };
  }

  @Get('me')
  me(@CurrentUser() user: User) { return user; }

  private startSession({ user, token }: { user: User; token: string }, response: Response) {
    setSessionCookie(response, token, this.environment);
    return user;
  }

}

@Controller()
export class LeaveController {
  constructor(@Inject(LeaveService) private readonly service: LeaveService) {}

  @Get('workspace')
  workspace(@CurrentUser() user: User, @Query({ schema: yearSchema }) query: z.infer<typeof yearSchema>) {
    return this.service.workspace(user, query.year);
  }

  @Roles('employee')
  @Post('requests')
  create(@CurrentUser() user: User, @Body({ schema: requestSchema }) input: CreateRequestInput) {
    return this.service.create(user, input);
  }

  @Roles('employee')
  @Post('requests/preview')
  @HttpCode(200)
  preview(@CurrentUser() user: User, @Body({ schema: requestSchema }) input: CreateRequestInput) {
    return this.service.preview(user, input);
  }

  @Roles('employee')
  @Post('requests/:id/preview')
  @HttpCode(200)
  previewEdit(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body({ schema: editRequestSchema }) input: EditRequestInput) {
    return this.service.preview(user, input, id, input.version);
  }

  @Roles('employee')
  @Patch('requests/:id')
  edit(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body({ schema: editRequestSchema }) input: EditRequestInput) {
    return this.service.edit(user, id, input);
  }

  @Roles('employee', 'manager')
  @Patch('requests/:id/status')
  transition(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body({ schema: transitionSchema }) input: z.infer<typeof transitionSchema>) {
    return this.service.transition(user, id, input.status, input.note, input.version);
  }

  @Roles('admin')
  @Put('admin/configuration')
  configure(@CurrentUser() user: User, @Body({ schema: configurationSchema }) input: ConfigurationInput) {
    return this.service.configure(user, input);
  }

  @Roles('admin')
  @Post('admin/leave-types')
  addLeaveType(@CurrentUser() user: User, @Body({ schema: leaveTypeSchema }) input: Omit<LeaveType, 'id'>) {
    return this.service.addLeaveType(user, input);
  }
}

@Controller('health')
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Public()
  @Get()
  async health() {
    await this.db.pool.query('SELECT 1');
    return { status: 'ok' };
  }
}
