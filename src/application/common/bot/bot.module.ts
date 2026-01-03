import { Module } from '@nestjs/common';
import {
  MessageHandler,
  CallbackHandler,
  CommandHandler,
} from '@infra/bot/handlers';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { OpenAIModule } from '../openai/openai.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * BotModule provides Telegram bot handlers
 * It imports all dependencies needed by handlers
 * TelegramBotService gets handlers via DI from this module
 */
@Module({
  imports: [NotificationModule, TaskModule, UserModule, OpenAIModule],
  providers: [MessageHandler, CallbackHandler, CommandHandler],
  exports: [MessageHandler, CallbackHandler, CommandHandler],
})
export class BotModule {}
