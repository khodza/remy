import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EnvValidationError, getEnv } from '@common/config';

async function bootstrap() {
  // Fail fast before Nest wires anything up.
  const env = getEnv();

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : true,
    credentials: false,
  });

  // Request validation is per-route: ZodValidationPipe with the schemas in
  // src/contract/remy-contract.ts (the same file the frontend parses with).

  // Enable graceful shutdown
  app.enableShutdownHooks();

  await app.listen(env.PORT);

  console.log('🤖 Remy bot is running...');
  console.log(`🌐 HTTP server listening on port ${env.PORT} (prefix /api/v1)`);
  if (env.OWNER_TELEGRAM_ID !== undefined) {
    console.log(
      `🔒 Owner lock on: only Telegram user ${env.OWNER_TELEGRAM_ID} is served`,
    );
  } else {
    console.warn(
      '⚠️  OWNER_TELEGRAM_ID is not set: the bot will answer anyone who finds it',
    );
  }
  if (env.DEV_ALLOW_MOCK_INITDATA) {
    console.warn(
      '⚠️  DEV_ALLOW_MOCK_INITDATA is on: unsigned mock initData is accepted (development only)',
    );
  }
  console.log('Press Ctrl+C to stop');
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(`❌ ${error.message}`);
  } else {
    console.error('Failed to start application:', error);
  }
  process.exit(1);
});
