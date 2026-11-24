import {
  Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res, UploadedFile, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { UPLOAD_LIMITS, type CreatePersonInput, type PasswordInput, type ProfileInput, type UpdatePersonInput, type User } from '@leave/contracts';
import { CurrentUser, Roles, type AuthenticatedRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { setSessionCookie } from '../auth/cookies.js';
import { ENVIRONMENT, type Environment } from '../config.js';
import { AccountsService } from '../accounts.service.js';
import { DocumentsService } from '../documents.service.js';
import { NotificationsService } from '../notifications.service.js';
import { createPersonSchema, passwordSchema, profileSchema, teamSchema, updatePersonSchema } from './schemas.js';

@Controller('profile')
export class ProfileController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  @Get()
  profile(@CurrentUser() user: User, @Req() request: AuthenticatedRequest) {
    return this.accounts.profile(user, request.demoSession === true);
  }

  @Roles('employee')
  @Put()
  update(@CurrentUser() user: User, @Body({ schema: profileSchema }) input: ProfileInput, @Req() request: AuthenticatedRequest) {
    return this.accounts.updateProfile(user, input, request.demoSession === true);
  }

  @Roles('employee')
  @Post('photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: UPLOAD_LIMITS.photoBytes, files: 1, fields: 0 } }))
  uploadPhoto(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined, @Req() request: AuthenticatedRequest) {
    return this.accounts.updatePhoto(user, file, request.demoSession === true);
  }

  @Get('photo')
  async photo(@CurrentUser() user: User, @Res() response: Response) {
    response.type('image/webp').send(await this.accounts.photo(user));
  }

  @Roles('employee')
  @Delete('photo')
  removePhoto(@CurrentUser() user: User, @Req() request: AuthenticatedRequest) {
    return this.accounts.removePhoto(user, request.demoSession === true);
  }

  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async password(@CurrentUser() user: User, @Body({ schema: passwordSchema }) input: PasswordInput, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.changePassword(user, input, request.demoSession === true);
    setSessionCookie(response, session.token, this.environment);
    return session.user;
  }
}

@Roles('admin')
@Controller('admin')
export class PeopleController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get('people')
  people(@CurrentUser() user: User) { return this.accounts.people(user); }

  @Post('people')
  create(@CurrentUser() user: User, @Body({ schema: createPersonSchema }) input: CreatePersonInput) {
    return this.accounts.createPerson(user, input);
  }

  @Put('people/:id')
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body({ schema: updatePersonSchema }) input: UpdatePersonInput) {
    return this.accounts.updatePerson(user, id, input);
  }

  @Post('teams')
  createTeam(@CurrentUser() user: User, @Body({ schema: teamSchema }) input: { name: string }) {
    return this.accounts.saveTeam(user, input.name);
  }

  @Put('teams/:id')
  updateTeam(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body({ schema: teamSchema }) input: { name: string }) {
    return this.accounts.saveTeam(user, input.name, id);
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: User) { return this.notifications.list(user); }

  @Patch(':id/read')
  read(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.notifications.markRead(user, id); }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: User) { return this.notifications.markRead(user); }
}

@Controller('requests/:requestId/documents')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: User, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.documents.list(user, requestId);
  }

  @Roles('employee')
  @Post()
  @UseInterceptors(FilesInterceptor('files', UPLOAD_LIMITS.documentsPerRequest, { limits: { fileSize: UPLOAD_LIMITS.documentBytes, files: UPLOAD_LIMITS.documentsPerRequest, fields: 0 } }))
  upload(@CurrentUser() user: User, @Param('requestId', ParseUUIDPipe) requestId: string, @UploadedFiles() files: Express.Multer.File[] | undefined) {
    return this.documents.upload(user, requestId, files ?? []);
  }

  @Get(':id/file')
  async download(@CurrentUser() user: User, @Param('requestId', ParseUUIDPipe) requestId: string, @Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    const file = await this.documents.download(user, requestId, id);
    response.attachment(file.filename).type('application/octet-stream').send(file.content);
  }

  @Roles('employee')
  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('requestId', ParseUUIDPipe) requestId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(user, requestId, id);
  }
}
