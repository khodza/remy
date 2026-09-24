/**
 * Google Calendar, read-only: the owner connects one Google account and the
 * morning brief lists the day's events next to the day's tasks.
 */

/** A connected Google account. Tokens are plain here; the repository encrypts them. */
export type GoogleConnection = {
  userId: string;
  /** The Google account's e-mail, for the status screen. Null when unknown. */
  email: string | null;
  /** Long-lived; the only thing that survives an access token expiry. */
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  /**
   * Calendar ids that feed the brief. Empty = the primary calendar only
   * (the default until the owner picks otherwise).
   */
  selectedCalendarIds: string[];
  connectedAt: Date;
  updatedAt: Date;
};

export type SaveGoogleConnectionParams = {
  userId: string;
  email: string | null;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
};

/** One row of the user's calendar list. */
export type GoogleCalendarInfo = {
  id: string;
  summary: string;
  primary: boolean;
};

/** Google's OAuth tokens after a code exchange or a refresh. */
export type GoogleTokens = {
  accessToken: string;
  /** Only on the first consent (or with prompt=consent); null on refresh. */
  refreshToken: string | null;
  expiresAt: Date;
};

/**
 * An event as Google returns it, before the day filter. `start`/`end` carry
 * either `dateTime` (an instant) or `date` (yyyy-MM-dd, all-day).
 */
export type RawCalendarEvent = {
  id: string;
  title: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  /** The owner answered "No" to the invitation. */
  declined: boolean;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location: string | null;
};

/** An event of the user's day, ready to show. */
export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  allDay: boolean;
  /** For all-day events: local midnight of the first / the day after the last day. */
  start: Date;
  end: Date;
  location: string | null;
};
