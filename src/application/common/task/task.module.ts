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
} from '@usecases/task';
import { UserModule } from '../user/user.module';
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
  ],
})
export class TaskModule {}
