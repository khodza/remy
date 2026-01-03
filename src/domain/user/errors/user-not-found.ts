import { ApplicationError } from '@domain/error';

export class UserNotFoundError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
