import { ApplicationError } from '@domain/error';

export class TaskNotFoundError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
