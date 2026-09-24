import type { SpeechInput, SpeechOutput } from './types';

/** Text to speech, for the spoken morning brief. */
export interface SpeechGateway {
  synthesize(input: SpeechInput): Promise<SpeechOutput>;
}
