import { ApplicationError } from '@domain/error';

/** GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URL are not all set. */
export class GoogleNotConfiguredError extends ApplicationError {
  constructor(message = 'Google Calendar is not configured on this server') {
    super(message);
  }
}

/** The callback's state is missing, forged, for another user, or expired. */
export class InvalidConnectStateError extends ApplicationError {
  constructor(message = 'This connect link is invalid or has expired') {
    super(message);
  }
}

/** No Google account is connected for this user. */
export class GoogleNotConnectedError extends ApplicationError {
  constructor(message = 'No Google account is connected') {
    super(message);
  }
}

/**
 * Google rejected the credentials (invalid_grant, 401): the grant was
 * revoked or the client changed. Retrying cannot help; reconnecting can.
 */
export class GoogleAuthError extends ApplicationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/** Anything else that went wrong talking to Google (5xx, timeout, bad JSON). */
export class GoogleApiError extends ApplicationError {
  constructor(
    message: string,
    cause?: unknown,
    public readonly status: number | null = null,
  ) {
    super(message, cause);
  }
}
