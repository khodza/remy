import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Domain } from '@common/tokens';
import { Collections } from '@infra/mongodb';
import { TaskSchema } from '@infra/mongodb/task/schema';
import { TaskRepositoryImpl } from '@infra/mongodb/task/repository';
import {
  ProcessTextMessageUsecase,
  ProcessVoiceMessageUsecase,
  MarkCompleteUsecase,
  DelayTaskUsecase,
  ListTasksUsecase,
  DeleteTaskUsecase,
  SendPendingRemindersUsecase,
  CreateStructuredTaskUsecase,
  UpdateTaskUsecase,
  ReopenTaskUsecase,
  SnoozeTaskUsecase,
  SkipOccurrenceUsecase,
  ListListsUsecase,
} from '@usecases/task';
import { UserModule } from '../user/user.module';
import { ConversationModule } from '../conversation/conversation.module';
import { OpenAIModule } from '../openai/openai.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Collections.Tasks, schema: TaskSchema },
    ]),
    OpenAIModule,
    NotificationModule,
    UserModule,
    ConversationModule,
  ],
  providers: [
    {
      provide: Domain.Task.Repository,
      useClass: TaskRepositoryImpl,
    },
    ProcessTextMessageUsecase,
    ProcessVoiceMessageUsecase,
    MarkCompleteUsecase,
    DelayTaskUsecase,
    ListTasksUsecase,
    DeleteTaskUsecase,
    SendPendingRemindersUsecase,
    CreateStructuredTaskUsecase,
    UpdateTaskUsecase,
    ReopenTaskUsecase,
    SnoozeTaskUsecase,
    SkipOccurrenceUsecase,
    ListListsUsecase,
  ],
  exports: [
    Domain.Task.Repository,
    ProcessTextMessageUsecase,
    ProcessVoiceMessageUsecase,
    MarkCompleteUsecase,
    DelayTaskUsecase,
    ListTasksUsecase,
    DeleteTaskUsecase,
    SendPendingRemindersUsecase,
    CreateStructuredTaskUsecase,
    UpdateTaskUsecase,
    ReopenTaskUsecase,
    SnoozeTaskUsecase,
    SkipOccurrenceUsecase,
    ListListsUsecase,
  ],
})
export class TaskModule {}
