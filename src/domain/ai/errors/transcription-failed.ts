import { ApplicationError } from '@domain/error';

export class TranscriptionFailedError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
