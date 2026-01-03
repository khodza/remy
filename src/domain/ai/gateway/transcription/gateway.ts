import { TranscriptionInput, TranscriptionOutput } from './types';

export interface TranscriptionGateway {
  transcribe(input: TranscriptionInput): Promise<TranscriptionOutput>;
}
