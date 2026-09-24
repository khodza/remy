import type { INestApplication } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import type { Env } from '@common/config';

/**
 * Everything main.ts does to the Nest app before listen(), in one place so
 * the e2e tests boot exactly the same app.
 */
export function configureApp(
  app: INestApplication,
  env: Pick<Env, 'CORS_ORIGINS'>,
): void {
  // pino (nestjs-pino) as the Nest logger: JSON in production, request ids.
  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : true,
    credentials: false,
  });

  // Request validation is per-route: ZodValidationPipe with the schemas in
  // src/contract/remy-contract.ts (the same file the frontend parses with).

  // SIGTERM/SIGINT → onModuleDestroy → HTTP server and Mongo close.
  app.enableShutdownHooks();
}
