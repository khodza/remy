import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TaskModule } from './application/common/task/task.module';
import { UserModule } from './application/common/user/user.module';
import { OpenAIModule } from './application/common/openai/openai.module';
import { NotificationModule } from './application/common/notification/notification.module';
import { BotModule } from './application/common/bot/bot.module';
import { RemindersSchedulerModule } from './application/common/scheduler/scheduler.module';
import { HttpModule } from './application/common/http/http.module';
import { LoggerModule } from 'nestjs-pino';
import { getEnv, loadEnv } from '@common/config';
import { loggerParams } from './application/common/logging/logger.options';

@Module({
  imports: [
    // `validate` runs once at boot and throws a readable list of problems
    // (EnvValidationError) instead of letting a bad value surface later.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => loadEnv(config),
    }),
    // pino: request ids, JSON in production. How to log: CLAUDE.md "Logging".
    LoggerModule.forRootAsync({ useFactory: () => loggerParams(getEnv()) }),
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: getEnv().MONGODB_URI }),
    }),
    TaskModule,
    UserModule,
    OpenAIModule,
    NotificationModule,
    BotModule, // Import after NotificationModule to provide handlers
    RemindersSchedulerModule,
    HttpModule,
  ],
})
export class AppModule {}
