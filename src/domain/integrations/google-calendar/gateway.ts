import type {
  GoogleCalendarInfo,
  GoogleTokens,
  RawCalendarEvent,
} from './types';

/**
 * The Google side: OAuth 2.0 and the Calendar REST API. Implemented with a
 * small HTTP client; throws GoogleNotConfiguredError when the OAuth client
 * is not set up, GoogleAuthError when Google rejects the credentials
 * (invalid_grant: the owner revoked access) and GoogleApiError otherwise.
 */
export interface GoogleCalendarGateway {
  /** False until GOOGLE_CLIENT_ID / SECRET / REDIRECT_URL are all set. */
  isConfigured(): boolean;
  /** Where to send the owner's browser; `state` comes back on the callback. */
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<GoogleTokens>;
  /** The account's e-mail (userinfo.email scope); null when Google omits it. */
  fetchEmail(accessToken: string): Promise<string | null>;
  /** Best effort: Google forgets the grant. Never throws on a dead token. */
  revoke(token: string): Promise<void>;
  listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]>;
  /** Single instances of the calendar's events overlapping [timeMin, timeMax). */
  listEvents(
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<RawCalendarEvent[]>;
}

/** Signs the OAuth `state` so a callback can only complete the owner's own connect. */
export interface ConnectStateSigner {
  sign(userId: string, now?: Date): string;
  /** The user the state was issued for, or null when forged or expired. */
  verify(state: string, now?: Date): { userId: string } | null;
}

/** Tells the owner in the chat that the account was connected. Best effort. */
export interface GoogleConnectionNotifier {
  connected(input: { chatId: number; email: string | null }): Promise<void>;
}
