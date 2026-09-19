import { Module } from '@nestjs/common';
import {
  MessageHandler,
  CallbackHandler,
  CommandHandler,
} from '@infra/bot/handlers';
import { AssistantResponder } from '@infra/bot/assistant.responder';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { NotificationModule } from '../notification/notification.module';
import { AssistantModule } from '../assistant/assistant.module';
import { ConversationModule } from '../conversation/conversation.module';
import { RhythmModule } from '../rhythm/rhythm.module';

@Module({
  imports: [
    NotificationModule,
    TaskModule,
    UserModule,
    AssistantModule,
    ConversationModule,
    RhythmModule,
  ],
  providers: [
    AssistantResponder,
    MessageHandler,
    CallbackHandler,
    CommandHandler,
  ],
  exports: [MessageHandler, CallbackHandler, CommandHandler],
})
export class BotModule {}
