import { Module } from '@nestjs/common';
import {
  ExportDataUsecase,
  ImportTasksUsecase,
  ManageCalendarFeedUsecase,
  ParseListUsecase,
  RenderCalendarFeedUsecase,
} from '@usecases/data';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { OpenAIModule } from '../openai/openai.module';
import { NotificationModule } from '../notification/notification.module';

/** Your data in and out: calendar feed, export, list import. */
@Module({
  imports: [TaskModule, UserModule, OpenAIModule, NotificationModule],
  providers: [
    ManageCalendarFeedUsecase,
    RenderCalendarFeedUsecase,
    ExportDataUsecase,
    ParseListUsecase,
    ImportTasksUsecase,
  ],
  exports: [
    ManageCalendarFeedUsecase,
    RenderCalendarFeedUsecase,
    ExportDataUsecase,
    ParseListUsecase,
    ImportTasksUsecase,
  ],
})
export class DataModule {}
