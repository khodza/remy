import { ApplicationError } from '@domain/error';

export class SpeechSynthesisFailedError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
