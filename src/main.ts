import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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
