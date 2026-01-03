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
} from '@usecases/task';
import { OpenAIModule } from '../openai/openai.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Collections.Tasks, schema: TaskSchema },
    ]),
    OpenAIModule,
    NotificationModule,
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
  ],
})
export class TaskModule {}
