import { Module } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { TranscriptionGatewayImpl } from '@infra/openai/transcription/gateway';
import { InterpreterGatewayImpl } from '@infra/openai/assistant/gateway';

@Module({
  providers: [
    {
      provide: Domain.AI.TranscriptionGateway,
      useClass: TranscriptionGatewayImpl,
    },
    {
      provide: Domain.Assistant.InterpreterGateway,
      useClass: InterpreterGatewayImpl,
    },
  ],
  exports: [
    Domain.AI.TranscriptionGateway,
    Domain.Assistant.InterpreterGateway,
  ],
})
export class OpenAIModule {}
