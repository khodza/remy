import { Module } from '@nestjs/common';
import {
  DigestBuilder,
  MoveOverdueToTodayUsecase,
  RefreshPinnedAgendaUsecase,
  ResolveReviewItemUsecase,
  SendDailyDigestsUsecase,
} from '@usecases/rhythm';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { ConversationModule } from '../conversation/conversation.module';
import { NotificationModule } from '../notification/notification.module';
import { AssistantModule } from '../assistant/assistant.module';
import { OpenAIModule } from '../openai/openai.module';

/** The daily rhythm: morning brief, evening review, weekly wrap, pinned agenda. */
@Module({
  imports: [
    TaskModule,
    UserModule,
    ConversationModule,
    NotificationModule,
    AssistantModule,
    OpenAIModule,
  ],
  providers: [
    DigestBuilder,
    SendDailyDigestsUsecase,
    ResolveReviewItemUsecase,
    MoveOverdueToTodayUsecase,
    RefreshPinnedAgendaUsecase,
  ],
  exports: [
    DigestBuilder,
    SendDailyDigestsUsecase,
    ResolveReviewItemUsecase,
    MoveOverdueToTodayUsecase,
    RefreshPinnedAgendaUsecase,
  ],
})
export class RhythmModule {}
