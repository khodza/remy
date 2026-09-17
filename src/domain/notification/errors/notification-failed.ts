import { ApplicationError } from '@domain/error';

export class NotificationFailedError extends ApplicationError {
  /**
   * True when retrying cannot help (e.g. the user blocked the bot), so the
   * caller should stop retrying instead of failing again on every tick.
   */
  public readonly permanent: boolean;

  constructor(
    message: string,
    cause?: unknown,
    options: { permanent?: boolean } = {},
  ) {
    super(message, cause);
    this.permanent = options.permanent ?? false;
  }
}
