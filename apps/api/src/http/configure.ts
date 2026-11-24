import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import type { Environment } from '../config.js';

export function configureHttp(app: NestExpressApplication, environment: Environment): void {
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '64kb' });
  app.use(helmet());
  app.use(cookieParser());
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  if (environment.NODE_ENV === 'production') app.set('trust proxy', 1);
}
