import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Domain } from '@common/tokens';
import { Collections } from '@infra/mongodb';
import {
  BotMessageSchema,
  ConversationRepositoryImpl,
  ConversationSchema,
  UndoRecordSchema,
} from '@infra/mongodb/conversation';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Collections.BotMessages, schema: BotMessageSchema },
      { name: Collections.Conversations, schema: ConversationSchema },
      { name: Collections.UndoRecords, schema: UndoRecordSchema },
    ]),
  ],
  providers: [
    {
      provide: Domain.Conversation.Repository,
      useClass: ConversationRepositoryImpl,
    },
  ],
  exports: [Domain.Conversation.Repository],
})
export class ConversationModule {}
