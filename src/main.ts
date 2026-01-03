import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';

// Polyfill crypto for Node.js < 19 (needed by @nestjs/schedule)
if (!globalThis.crypto) {
  (globalThis as any).crypto = crypto.webcrypto;
}

// Polyfill fetch and FormData (needed by OpenAI SDK)
if (!globalThis.fetch) {
  (globalThis as any).fetch = fetch;
}

if (!globalThis.FormData) {
  (globalThis as any).FormData = FormData;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Enable graceful shutdown
  app.enableShutdownHooks();

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);

  console.log('🤖 Remy bot is running...');
  console.log(`🌐 HTTP server listening on port ${port}`);
  console.log('📅 Reminder scheduler should trigger every minute');
  console.log('Press Ctrl+C to stop');
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
