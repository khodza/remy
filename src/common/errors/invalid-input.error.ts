import { ApplicationError } from '@domain/error';

export class InvalidInputError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
