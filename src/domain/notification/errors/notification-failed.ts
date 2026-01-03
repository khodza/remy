import { ApplicationError } from '@domain/error';

export class NotificationFailedError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
