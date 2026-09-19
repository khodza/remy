import { Module } from '@nestjs/common';
import {
  DigestBuilder,
  MoveOverdueToTodayUsecase,
  ResolveReviewItemUsecase,
  SendDailyDigestsUsecase,
} from '@usecases/rhythm';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { ConversationModule } from '../conversation/conversation.module';
import { NotificationModule } from '../notification/notification.module';
import { AssistantModule } from '../assistant/assistant.module';

/** The daily rhythm: morning brief, evening review, weekly wrap. */
@Module({
  imports: [
    TaskModule,
    UserModule,
    ConversationModule,
    NotificationModule,
    AssistantModule,
  ],
  providers: [
    DigestBuilder,
    SendDailyDigestsUsecase,
    ResolveReviewItemUsecase,
    MoveOverdueToTodayUsecase,
  ],
  exports: [
    DigestBuilder,
    SendDailyDigestsUsecase,
    ResolveReviewItemUsecase,
    MoveOverdueToTodayUsecase,
  ],
})
export class RhythmModule {}
