import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EnvValidationError, getEnv } from '@common/config';
import { configureApp } from './bootstrap';

async function bootstrap() {
  // Fail fast before Nest wires anything up.
  const env = getEnv();

  // Boot messages (e.g. Mongo retries) use Nest's console logger, as JSON in
  // production; from configureApp on, everything goes through pino. (Not
  // bufferLogs: that would hide the Mongo retries until Mongo is up.)
  const app = await NestFactory.create(AppModule, {
    ...(env.NODE_ENV === 'production'
      ? { logger: new ConsoleLogger({ json: true }) }
      : {}),
  });
  configureApp(app, env);
  const logger = new Logger('Bootstrap');

  await app.listen(env.PORT);

  logger.log(
    `HTTP server listening on port ${env.PORT} (API under /api/v1, NODE_ENV=${env.NODE_ENV})`,
  );
  if (env.OWNER_TELEGRAM_ID !== undefined) {
    logger.log(
      `Owner lock on: only Telegram user ${env.OWNER_TELEGRAM_ID} is served`,
    );
  } else {
    logger.warn(
      'OWNER_TELEGRAM_ID is not set: the bot will answer anyone who finds it',
    );
  }
  if (env.DEV_ALLOW_MOCK_INITDATA) {
    logger.warn(
      'DEV_ALLOW_MOCK_INITDATA is on: unsigned mock initData is accepted (development only)',
    );
  }
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  if (error instanceof EnvValidationError) {
    logger.fatal(error.message);
  } else {
    logger.fatal(
      `Failed to start application: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
  // Right away: ConfigModule's own validation of a bad env would otherwise
  // surface a second time as an unhandled rejection. pino flushes on exit.
  process.exit(1);
});
