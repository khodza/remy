/** What GET /integrations/google/status (and the bot's /connect) show. */
export type GoogleStatus = {
  /** The OAuth client is set up on this server (env). */
  configured: boolean;
  connected: boolean;
  /** The connected account's e-mail, when known. */
  email?: string | null;
  /** The account's calendars, when Google could be reached; `selected` = feeds the brief. */
  calendars?: { id: string; summary: string; selected: boolean }[];
};

/** How long the day's events are kept before asking Google again. */
export const CALENDAR_EVENTS_CACHE_MS = 5 * 60_000;

/** Google's alias for the account's main calendar. */
export const PRIMARY_CALENDAR_ID = 'primary';
