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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRoot(
      process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/remy',
    ),
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
