import { ApplicationError } from '@domain/error';

export class FailedToCreateTaskError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
