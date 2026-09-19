import { Module } from '@nestjs/common';
import {
  HandleMessageUsecase,
  TranscribeAudioUsecase,
  UndoActionUsecase,
  UndoRecorder,
} from '@usecases/assistant';
import { ListCategoriesUsecase } from '@usecases/category';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { OpenAIModule } from '../openai/openai.module';
import { ConversationModule } from '../conversation/conversation.module';

/** The chat brain: interpret a message, act on it, remember how to undo it. */
@Module({
  imports: [TaskModule, UserModule, OpenAIModule, ConversationModule],
  providers: [
    ListCategoriesUsecase,
    HandleMessageUsecase,
    TranscribeAudioUsecase,
    UndoActionUsecase,
    UndoRecorder,
  ],
  exports: [
    HandleMessageUsecase,
    TranscribeAudioUsecase,
    UndoActionUsecase,
    UndoRecorder,
  ],
})
export class AssistantModule {}
