export abstract class ApplicationError extends Error {
  public override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}
