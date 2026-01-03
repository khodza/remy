import { ApplicationError } from '@domain/error';

export class ParsingFailedError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
