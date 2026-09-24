import { Module } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { TranscriptionGatewayImpl } from '@infra/openai/transcription/gateway';
import { InterpreterGatewayImpl } from '@infra/openai/assistant/gateway';
import { SpeechGatewayImpl } from '@infra/openai/speech/gateway';

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
    { provide: Domain.AI.SpeechGateway, useClass: SpeechGatewayImpl },
  ],
  exports: [
    Domain.AI.TranscriptionGateway,
    Domain.Assistant.InterpreterGateway,
    Domain.AI.SpeechGateway,
  ],
})
export class OpenAIModule {}
