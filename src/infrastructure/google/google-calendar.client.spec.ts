import {
  GOOGLE_SCOPES,
  GoogleCalendarGatewayImpl,
  googleConfigFromEnv,
  type FetchLike,
} from './google-calendar.client';
import {
  GoogleApiError,
  GoogleAuthError,
  GoogleNotConfiguredError,
} from '@domain/integrations/google-calendar';

const config = {
  clientId: 'client-id.apps.googleusercontent.com',
  clientSecret: 'shh',
  redirectUrl: 'https://remy.example.com/api/v1/integrations/google/callback',
};

type Answer = { status: number; body?: unknown } | Error;

/** A fetch that answers from a queue and records every call. */
function fakeFetch(answers: Answer[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    if (next instanceof Error) throw next;
    const { status, body } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
  };
  return { fetchImpl, calls };
}

function form(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(init?.body)));
}

describe('GoogleCalendarGatewayImpl', () => {
  it('is "not configured" until every env variable is set', () => {
    const { fetchImpl } = fakeFetch([]);
    const off = new GoogleCalendarGatewayImpl(() => null, fetchImpl);
    expect(off.isConfigured()).toBe(false);
    expect(() => off.authorizationUrl('s')).toThrow(GoogleNotConfiguredError);
    delete process.env['GOOGLE_CLIENT_ID'];
    expect(googleConfigFromEnv()).toBeNull();
    process.env['GOOGLE_CLIENT_ID'] = 'id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'secret';
    process.env['GOOGLE_REDIRECT_URL'] = 'https://x.example/cb';
    expect(googleConfigFromEnv()).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUrl: 'https://x.example/cb',
    });
    delete process.env['GOOGLE_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_SECRET'];
    delete process.env['GOOGLE_REDIRECT_URL'];
  });

  it('builds the consent URL with offline access and read-only scopes', () => {
    const gateway = new GoogleCalendarGatewayImpl(() => config);
    const url = new URL(gateway.authorizationUrl('the-state'));
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('client_id')).toBe(config.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUrl);
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_SCOPES);
    expect(url.searchParams.get('scope')).not.toContain('calendar.events');
  });

  it('exchanges a code and refreshes a token through the token endpoint', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 },
      },
      { status: 200, body: { access_token: 'at-2', expires_in: 1800 } },
    ]);
    const gateway = new GoogleCalendarGatewayImpl(() => config, fetchImpl);
    const before = Date.now();
    const tokens = await gateway.exchangeCode('4/code');
    expect(tokens).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1' });
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 3600_000,
    );
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(form(calls[0]?.init)).toEqual({
      code: '4/code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUrl,
      grant_type: 'authorization_code',
    });

    const refreshed = await gateway.refreshAccessToken('rt-1');
    expect(refreshed).toMatchObject({
      accessToken: 'at-2',
      refreshToken: null,
    });
    expect(form(calls[1]?.init)).toMatchObject({
      refresh_token: 'rt-1',
      grant_type: 'refresh_token',
    });
  });

  it('maps invalid_grant and 401 to GoogleAuthError, retries 5xx once, gives up after', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Token revoked' },
      },
      { status: 401, body: { error: { message: 'Invalid Credentials' } } },
      { status: 503 },
      { status: 200, body: { email: 'owner@example.com' } },
      { status: 500 },
      new Error('socket hang up'),
    ]);
    const gateway = new GoogleCalendarGatewayImpl(() => config, fetchImpl);
    await expect(gateway.refreshAccessToken('dead')).rejects.toThrow(
      GoogleAuthError,
    );
    await expect(gateway.fetchEmail('bad')).rejects.toThrow(GoogleAuthError);
    // 503 then 200: the retry rescued it.
    expect(await gateway.fetchEmail('ok')).toBe('owner@example.com');
    // 500 then a network error: two attempts, then GoogleApiError.
    await expect(gateway.fetchEmail('ok')).rejects.toBeInstanceOf(
      GoogleApiError,
    );
    expect(calls).toHaveLength(6);
    expect(calls[3]?.init?.headers).toEqual({ Authorization: 'Bearer ok' });
  });

  it('does not retry a code exchange (an auth code is single-use)', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 500 }, { status: 200 }]);
    const gateway = new GoogleCalendarGatewayImpl(() => config, fetchImpl);
    await expect(gateway.exchangeCode('4/code')).rejects.toBeInstanceOf(
      GoogleApiError,
    );
    expect(calls).toHaveLength(1);
  });

  it('lists events across pages with status, declined, all-day and a fallback title', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          nextPageToken: 'p2',
          items: [
            {
              id: 'e1',
              summary: 'Standup',
              start: { dateTime: '2026-09-24T09:30:00+05:00' },
              end: { dateTime: '2026-09-24T09:45:00+05:00' },
              attendees: [{ self: true, responseStatus: 'accepted' }],
              location: 'Meet',
            },
            {
              id: 'e2',
              status: 'cancelled',
              start: { dateTime: '2026-09-24T10:00:00Z' },
              end: { dateTime: '2026-09-24T11:00:00Z' },
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          items: [
            {
              id: 'e3',
              start: { date: '2026-09-24' },
              end: { date: '2026-09-25' },
              attendees: [
                { email: 'x@y.z', responseStatus: 'accepted' },
                { self: true, responseStatus: 'declined' },
              ],
            },
            { summary: 'no id, dropped' },
          ],
        },
      },
    ]);
    const gateway = new GoogleCalendarGatewayImpl(() => config, fetchImpl);
    const events = await gateway.listEvents(
      'at',
      'team@group.calendar.google.com',
      new Date('2026-09-23T19:00:00Z'),
      new Date('2026-09-24T19:00:00Z'),
    );
    expect(events).toEqual([
      {
        id: 'e1',
        title: 'Standup',
        status: 'confirmed',
        declined: false,
        start: { dateTime: '2026-09-24T09:30:00+05:00' },
        end: { dateTime: '2026-09-24T09:45:00+05:00' },
        location: 'Meet',
      },
      {
        id: 'e2',
        title: '(No title)',
        status: 'cancelled',
        declined: false,
        start: { dateTime: '2026-09-24T10:00:00Z' },
        end: { dateTime: '2026-09-24T11:00:00Z' },
        location: null,
      },
      {
        id: 'e3',
        title: '(No title)',
        status: 'confirmed',
        declined: true,
        start: { date: '2026-09-24' },
        end: { date: '2026-09-25' },
        location: null,
      },
    ]);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe(
      '/calendar/v3/calendars/team%40group.calendar.google.com/events',
    );
    expect(first.searchParams.get('singleEvents')).toBe('true');
    expect(first.searchParams.get('timeMin')).toBe('2026-09-23T19:00:00.000Z');
    expect(first.searchParams.get('timeMax')).toBe('2026-09-24T19:00:00.000Z');
    expect(new URL(calls[1]!.url).searchParams.get('pageToken')).toBe('p2');
  });

  it('lists calendars with the override name, the primary flag, without deleted ones', async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          items: [
            { id: 'owner@example.com', summary: 'Owner', primary: true },
            { id: 'fam', summary: 'Family', summaryOverride: 'Home' },
            { id: 'old', summary: 'Old', deleted: true },
          ],
        },
      },
    ]);
    const gateway = new GoogleCalendarGatewayImpl(() => config, fetchImpl);
    expect(await gateway.listCalendars('at')).toEqual([
      { id: 'owner@example.com', summary: 'Owner', primary: true },
      { id: 'fam', summary: 'Home', primary: false },
    ]);
  });

  it('revoke is best effort', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 400, body: { error: 'invalid_token' } },
    ]);
    const gateway = new GoogleCalendarGatewayImpl(() => config, fetchImpl);
    await expect(gateway.revoke('rt')).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(form(calls[0]?.init)).toEqual({ token: 'rt' });
  });
});
