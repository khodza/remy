import type {
  ConnectStateSigner,
  GoogleCalendarGateway,
  GoogleCalendarInfo,
  GoogleConnection,
  GoogleConnectionNotifier,
  GoogleConnectionRepository,
  GoogleTokens,
  RawCalendarEvent,
} from '@domain/integrations/google-calendar';

export function makeGoogleConnection(
  overrides: Partial<GoogleConnection> = {},
): GoogleConnection {
  const at = new Date('2026-09-20T10:00:00Z');
  return {
    userId: 'user-1',
    email: 'owner@example.com',
    refreshToken: 'rt-1',
    accessToken: 'at-1',
    accessTokenExpiresAt: new Date('2099-01-01T00:00:00Z'),
    selectedCalendarIds: [],
    connectedAt: at,
    updatedAt: at,
    ...overrides,
  };
}

/** In-memory connection store: save / update / delete really apply. */
export function mockGoogleConnectionRepository(
  initial: GoogleConnection | null = null,
): jest.Mocked<GoogleConnectionRepository> & {
  current: () => GoogleConnection | null;
} {
  let connection = initial;
  return {
    current: () => connection,
    findByUserId: jest.fn(async (userId: string) =>
      connection && connection.userId === userId ? connection : null,
    ),
    save: jest.fn(async (params) => {
      const now = new Date();
      connection = {
        ...params,
        selectedCalendarIds: connection?.selectedCalendarIds ?? [],
        connectedAt: now,
        updatedAt: now,
      };
      return connection;
    }),
    updateAccessToken: jest.fn(async (_userId, accessToken, expiresAt) => {
      if (connection)
        connection = {
          ...connection,
          accessToken,
          accessTokenExpiresAt: expiresAt,
        };
    }),
    updateSelection: jest.fn(async (_userId, calendarIds: string[]) => {
      if (connection)
        connection = { ...connection, selectedCalendarIds: calendarIds };
    }),
    delete: jest.fn(async (_userId: string) => {
      const had = connection !== null;
      connection = null;
      return had;
    }),
  };
}

export const primaryCalendar: GoogleCalendarInfo = {
  id: 'owner@example.com',
  summary: 'Owner',
  primary: true,
};
export const familyCalendar: GoogleCalendarInfo = {
  id: 'family@group.calendar.google.com',
  summary: 'Family',
  primary: false,
};

/** A configured Google that answers from fixtures. */
export function mockGoogleCalendarGateway(
  options: {
    configured?: boolean;
    calendars?: GoogleCalendarInfo[];
    events?: Record<string, RawCalendarEvent[]>;
  } = {},
): jest.Mocked<GoogleCalendarGateway> {
  const configured = options.configured ?? true;
  return {
    isConfigured: jest.fn(() => configured),
    authorizationUrl: jest.fn(
      (state: string) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    ),
    exchangeCode: jest.fn(async (code: string) => ({
      accessToken: `at-for-${code}`,
      refreshToken: `rt-for-${code}`,
      expiresAt: new Date(Date.now() + 3600_000),
    })),
    refreshAccessToken: jest.fn(
      async (_refreshToken: string): Promise<GoogleTokens> => ({
        accessToken: 'at-refreshed',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    ),
    fetchEmail: jest.fn(
      async (_accessToken: string): Promise<string | null> =>
        'owner@example.com',
    ),
    revoke: jest.fn(async (_token: string): Promise<void> => undefined),
    listCalendars: jest.fn(
      async (_accessToken: string) =>
        options.calendars ?? [primaryCalendar, familyCalendar],
    ),
    listEvents: jest.fn(
      async (
        _token: string,
        calendarId: string,
        _timeMin: Date,
        _timeMax: Date,
      ) => options.events?.[calendarId] ?? [],
    ),
  };
}

/** A signer whose states are readable, for tests that do not test signing. */
export function fakeStateSigner(): jest.Mocked<ConnectStateSigner> {
  return {
    sign: jest.fn((userId: string) => `state-for-${userId}`),
    verify: jest.fn((state: string) =>
      state.startsWith('state-for-')
        ? { userId: state.slice('state-for-'.length) }
        : null,
    ),
  };
}

export function mockGoogleConnectionNotifier(): jest.Mocked<GoogleConnectionNotifier> {
  return {
    connected: jest.fn(
      async (_input: { chatId: number; email: string | null }) => undefined,
    ),
  };
}

export function rawEvent(
  overrides: Partial<RawCalendarEvent> & { id: string },
): RawCalendarEvent {
  return {
    title: 'Event',
    status: 'confirmed',
    declined: false,
    start: { dateTime: '2026-09-24T09:00:00+05:00' },
    end: { dateTime: '2026-09-24T10:00:00+05:00' },
    location: null,
    ...overrides,
  };
}
