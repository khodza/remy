import { getEnv } from '@common/config';
import { ApplicationError } from '@domain/error';
import {
  GoogleApiError,
  GoogleAuthError,
  GoogleNotConfiguredError,
  type GoogleCalendarGateway,
  type GoogleCalendarInfo,
  type GoogleTokens,
  type RawCalendarEvent,
} from '@domain/integrations/google-calendar';

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
};

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** Read-only calendar access plus the account e-mail; nothing else. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Same discipline as the OpenAI client: a hard timeout and one retry. */
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 1;
const PAGE_SIZE = 250;
const MAX_PAGES = 4;

export function googleConfigFromEnv(): GoogleOAuthConfig | null {
  const env = getEnv();
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URL
  ) {
    return null;
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUrl: env.GOOGLE_REDIRECT_URL,
  };
}

/**
 * A hand-written client for the two Google endpoints Remy needs (OAuth 2.0
 * tokens, Calendar v3 read-only). Built with a factory, not @Injectable, so
 * tests can pass a fake fetch and a fixed config.
 */
export class GoogleCalendarGatewayImpl implements GoogleCalendarGateway {
  constructor(
    private readonly config: () => GoogleOAuthConfig | null = googleConfigFromEnv,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  public isConfigured(): boolean {
    return this.config() !== null;
  }

  public authorizationUrl(state: string): string {
    const config = this.requireConfig();
    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    // offline + consent: Google only hands out a refresh token this way.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return url.toString();
  }

  public async exchangeCode(code: string): Promise<GoogleTokens> {
    const config = this.requireConfig();
    const body = await this.tokenRequest(
      {
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUrl,
        grant_type: 'authorization_code',
      },
      // An auth code is single-use: a retry after a timeout cannot succeed.
      { retry: false, what: 'code exchange' },
    );
    return toTokens(body);
  }

  public async refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
    const config = this.requireConfig();
    const body = await this.tokenRequest(
      {
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
      },
      { retry: true, what: 'token refresh' },
    );
    return toTokens(body);
  }

  public async fetchEmail(accessToken: string): Promise<string | null> {
    const body = await this.get(USERINFO_URL, accessToken, 'userinfo');
    const email = (body as { email?: unknown } | null)?.email;
    return typeof email === 'string' && email ? email : null;
  }

  public async revoke(token: string): Promise<void> {
    try {
      await this.request(
        REVOKE_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
        },
        { retry: false, what: 'revoke' },
      );
    } catch {
      // Best effort: an already-revoked or expired token answers 400.
    }
  }

  public async listCalendars(
    accessToken: string,
  ): Promise<GoogleCalendarInfo[]> {
    const items = await this.pages(
      `${CALENDAR_API}/users/me/calendarList`,
      { minAccessRole: 'reader', maxResults: String(PAGE_SIZE) },
      accessToken,
      'calendar list',
    );
    return items.flatMap((item) => {
      const row = item as {
        id?: unknown;
        summary?: unknown;
        summaryOverride?: unknown;
        primary?: unknown;
        deleted?: unknown;
      };
      if (typeof row.id !== 'string' || row.deleted === true) return [];
      const summary =
        typeof row.summaryOverride === 'string' && row.summaryOverride
          ? row.summaryOverride
          : typeof row.summary === 'string' && row.summary
            ? row.summary
            : row.id;
      return [{ id: row.id, summary, primary: row.primary === true }];
    });
  }

  public async listEvents(
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<RawCalendarEvent[]> {
    const items = await this.pages(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        singleEvents: 'true',
        orderBy: 'startTime',
        showDeleted: 'false',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: String(PAGE_SIZE),
      },
      accessToken,
      `events of ${calendarId}`,
    );
    return items.flatMap((item) => {
      const e = item as {
        id?: unknown;
        summary?: unknown;
        status?: unknown;
        location?: unknown;
        start?: { dateTime?: unknown; date?: unknown };
        end?: { dateTime?: unknown; date?: unknown };
        attendees?: { self?: unknown; responseStatus?: unknown }[];
      };
      if (typeof e.id !== 'string') return [];
      return [
        {
          id: e.id,
          title:
            typeof e.summary === 'string' && e.summary.trim()
              ? e.summary.trim()
              : '(No title)',
          status:
            e.status === 'cancelled' || e.status === 'tentative'
              ? e.status
              : 'confirmed',
          declined:
            Array.isArray(e.attendees) &&
            e.attendees.some(
              (a) => a.self === true && a.responseStatus === 'declined',
            ),
          start: timeField(e.start),
          end: timeField(e.end),
          location: typeof e.location === 'string' ? e.location : null,
        },
      ];
    });
  }

  // ---------------------------------------------------------------- http ---

  private requireConfig(): GoogleOAuthConfig {
    const config = this.config();
    if (!config) throw new GoogleNotConfiguredError();
    return config;
  }

  private async tokenRequest(
    form: Record<string, string>,
    options: { retry: boolean; what: string },
  ): Promise<unknown> {
    return this.request(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      },
      options,
    );
  }

  private async get(
    url: string,
    accessToken: string,
    what: string,
  ): Promise<unknown> {
    return this.request(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      { retry: true, what },
    );
  }

  /** Follows nextPageToken, a few pages at most (a day never needs more). */
  private async pages(
    base: string,
    params: Record<string, string>,
    accessToken: string,
    what: string,
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(base);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = (await this.get(url.toString(), accessToken, what)) as {
        items?: unknown;
        nextPageToken?: unknown;
      } | null;
      if (Array.isArray(body?.items)) items.push(...body.items);
      pageToken =
        typeof body?.nextPageToken === 'string' && body.nextPageToken
          ? body.nextPageToken
          : undefined;
      if (!pageToken) break;
    }
    return items;
  }

  private async request(
    url: string,
    init: RequestInit,
    options: { retry: boolean; what: string },
  ): Promise<unknown> {
    const attempts = options.retry ? 1 + MAX_RETRIES : 1;
    let lastError: unknown = new GoogleApiError(`${options.what} failed`);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await res.text();
        const body = parseJson(text);
        if (res.ok) return body;
        const error = toGoogleError(options.what, res.status, body);
        // 429 and 5xx may pass on the next try; everything else is final.
        if (res.status !== 429 && res.status < 500) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        // Network error or timeout (AbortError).
        lastError = new GoogleApiError(
          `${options.what}: request failed (${(error as Error)?.message ?? 'unknown error'})`,
          error,
        );
      }
    }
    throw lastError;
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toGoogleError(
  what: string,
  status: number,
  body: unknown,
): GoogleApiError | GoogleAuthError {
  const b = body as {
    error?: unknown;
    error_description?: unknown;
  } | null;
  const code =
    typeof b?.error === 'string'
      ? b.error
      : typeof (b?.error as { message?: unknown } | undefined)?.message ===
          'string'
        ? String((b?.error as { message: string }).message)
        : `HTTP ${status}`;
  const detail =
    typeof b?.error_description === 'string' ? ` (${b.error_description})` : '';
  // invalid_grant: the refresh token was revoked or expired; 401: the access
  // token is no good and neither is what made it.
  if (status === 401 || (status === 400 && code === 'invalid_grant')) {
    return new GoogleAuthError(`${what}: ${code}${detail}`);
  }
  return new GoogleApiError(`${what}: ${code}${detail}`, undefined, status);
}

function toTokens(body: unknown): GoogleTokens {
  const b = body as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  } | null;
  if (typeof b?.access_token !== 'string' || !b.access_token) {
    throw new GoogleApiError('Google returned no access token');
  }
  const expiresIn =
    typeof b.expires_in === 'number' && b.expires_in > 0 ? b.expires_in : 3600;
  return {
    accessToken: b.access_token,
    refreshToken:
      typeof b.refresh_token === 'string' && b.refresh_token
        ? b.refresh_token
        : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

function timeField(
  field: { dateTime?: unknown; date?: unknown } | undefined,
): RawCalendarEvent['start'] {
  return {
    ...(typeof field?.dateTime === 'string'
      ? { dateTime: field.dateTime }
      : {}),
    ...(typeof field?.date === 'string' ? { date: field.date } : {}),
  };
}
