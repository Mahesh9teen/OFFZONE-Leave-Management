import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ENVIRONMENT, readEnvironment } from './config.js';
import { Database } from './db/database.js';
import { PgLeaveRepository } from './db/leave.repository.js';
import { LeaveStore } from './leave.store.js';
import { LeaveService } from './leave.service.js';
import { Clock } from './clock.js';
import { Passwords } from './auth/passwords.js';
import { AuthService } from './auth/auth.service.js';
import { OriginGuard, SessionGuard } from './auth/guards.js';
import { AuthController, HealthController, LeaveController } from './http/controllers.js';
import { DatabaseErrorFilter, RuleErrorFilter } from './http/filters.js';
import { AccountsService } from './accounts.service.js';
import { DocumentsService } from './documents.service.js';
import { NotificationsService } from './notifications.service.js';
import { DocumentsController, NotificationsController, PeopleController, ProfileController } from './http/workspace.controllers.js';
import { MailModule } from '@nestjs/mail';
import { mailOptions, NotificationEmail } from './mail.service.js';
import { AutomationService } from './automation.service.js';

@Module({
  imports: [
    MailModule.forRootAsync({ useFactory: () => mailOptions(readEnvironment(process.env)) }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: readEnvironment(process.env).AUTH_SECRET,
        signOptions: { expiresIn: '8h', issuer: 'leave-management', audience: 'leave-web', algorithm: 'HS256' },
        verifyOptions: { issuer: 'leave-management', audience: 'leave-web', algorithms: ['HS256'] },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [AuthController, HealthController, LeaveController, ProfileController, PeopleController, DocumentsController, NotificationsController],
  providers: [
    { provide: ENVIRONMENT, useFactory: () => readEnvironment(process.env) },
    Database, Clock, Passwords, AuthService, LeaveService, AccountsService, DocumentsService, NotificationsService, NotificationEmail, AutomationService, PgLeaveRepository,
    { provide: LeaveStore, useExisting: PgLeaveRepository },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
    { provide: APP_FILTER, useClass: RuleErrorFilter },
    { provide: APP_FILTER, useClass: DatabaseErrorFilter },
  ],
})
export class AppModule {}
