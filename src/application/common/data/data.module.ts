import { Module } from '@nestjs/common';
import {
  ExportDataUsecase,
  DeleteAllDataUsecase,
  ImportTasksUsecase,
  ManageCalendarFeedUsecase,
  ParseListUsecase,
  RenderCalendarFeedUsecase,
} from '@usecases/data';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { OpenAIModule } from '../openai/openai.module';
import { NotificationModule } from '../notification/notification.module';
import { ConversationModule } from '../conversation/conversation.module';

/** Your data in and out: calendar feed, export, list import. */
@Module({
  imports: [
    TaskModule,
    UserModule,
    OpenAIModule,
    NotificationModule,
    ConversationModule,
  ],
  providers: [
    ManageCalendarFeedUsecase,
    RenderCalendarFeedUsecase,
    ExportDataUsecase,
    ParseListUsecase,
    ImportTasksUsecase,
    DeleteAllDataUsecase,
  ],
  exports: [
    ManageCalendarFeedUsecase,
    RenderCalendarFeedUsecase,
    ExportDataUsecase,
    ParseListUsecase,
    ImportTasksUsecase,
    DeleteAllDataUsecase,
  ],
})
export class DataModule {}
