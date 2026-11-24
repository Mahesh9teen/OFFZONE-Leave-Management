import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { Response } from 'express';
import { RuleError } from '../domain/rules.js';

@Catch(RuleError)
export class RuleErrorFilter implements ExceptionFilter<RuleError> {
  catch(error: RuleError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(error.status).json({ statusCode: error.status, message: error.message });
  }
}

@Catch(DatabaseError)
export class DatabaseErrorFilter implements ExceptionFilter<DatabaseError> {
  private readonly logger = new Logger(DatabaseErrorFilter.name);

  catch(error: DatabaseError, host: ArgumentsHost) {
    const conflict = error.code === '23505';
    if (!conflict) this.logger.error(`PostgreSQL operation failed (code ${error.code ?? 'unknown'}).`);
    const status = conflict ? 409 : 503;
    const message = conflict ? 'That name or record already exists.' : 'The database operation could not be completed. Please try again.';
    host.switchToHttp().getResponse<Response>().status(status).json({ statusCode: status, message });
  }
}
