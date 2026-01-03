import { Module } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { TranscriptionGatewayImpl } from '@infra/openai/transcription/gateway';
import { TaskParserGatewayImpl } from '@infra/openai/task-parser/gateway';

@Module({
  providers: [
    {
      provide: Domain.AI.TranscriptionGateway,
      useClass: TranscriptionGatewayImpl,
    },
    {
      provide: Domain.AI.TaskParserGateway,
      useClass: TaskParserGatewayImpl,
    },
  ],
  exports: [Domain.AI.TranscriptionGateway, Domain.AI.TaskParserGateway],
})
export class OpenAIModule {}
