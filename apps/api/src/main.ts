import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ENVIRONMENT, type Environment } from './config.js';
import { configureHttp } from './http/configure.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const environment = app.get<Environment>(ENVIRONMENT);
  configureHttp(app, environment);
  app.enableShutdownHooks();
  await app.listen(environment.PORT, environment.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
}
await bootstrap();
