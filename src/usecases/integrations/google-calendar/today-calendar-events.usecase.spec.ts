import { TodayCalendarEventsUsecase } from './today-calendar-events.usecase';
import { CALENDAR_EVENTS_CACHE_MS } from './types';
import {
  GoogleApiError,
  GoogleAuthError,
} from '@domain/integrations/google-calendar';
import {
  familyCalendar,
  makeGoogleConnection,
  mockGoogleCalendarGateway,
  mockGoogleConnectionRepository,
  rawEvent,
} from '@test/google-factories';

const tz = 'Asia/Tashkent';
const now = new Date('2026-09-24T03:00:00Z'); // Thu 08:00 local
const user = { id: 'user-1' };

const events = {
  primary: [
    rawEvent({ id: 'standup', title: 'Standup' }),
    rawEvent({ id: 'gone', status: 'cancelled' as const }),
    rawEvent({
      id: 'holiday',
      title: 'Holiday',
      start: { date: '2026-09-24' },
      end: { date: '2026-09-25' },
    }),
  ],
  [familyCalendar.id]: [
    rawEvent({
      id: 'dinner',
      title: 'Dinner',
      start: { dateTime: '2026-09-24T19:00:00+05:00' },
      end: { dateTime: '2026-09-24T21:00:00+05:00' },
    }),
  ],
};

describe('TodayCalendarEventsUsecase', () => {
  it('returns [] when not configured or not connected', async () => {
    const off = new TodayCalendarEventsUsecase(
      mockGoogleConnectionRepository(makeGoogleConnection()),
      mockGoogleCalendarGateway({ configured: false }),
    );
    expect(await off.eventsForDay(user, tz, now)).toEqual([]);
    const google = mockGoogleCalendarGateway({ events });
    const none = new TodayCalendarEventsUsecase(
      mockGoogleConnectionRepository(),
      google,
    );
    expect(await none.eventsForDay(user, tz, now)).toEqual([]);
    expect(google.listEvents).not.toHaveBeenCalled();
  });

  it("reads the primary calendar for the user's local day, all-day first", async () => {
    const google = mockGoogleCalendarGateway({ events });
    const usecase = new TodayCalendarEventsUsecase(
      mockGoogleConnectionRepository(makeGoogleConnection()),
      google,
    );
    const result = await usecase.eventsForDay(user, tz, now);
    expect(result.map((e) => e.title)).toEqual(['Holiday', 'Standup']);
    expect(google.listEvents).toHaveBeenCalledWith(
      'at-1',
      'primary',
      new Date('2026-09-23T19:00:00Z'),
      new Date('2026-09-24T19:00:00Z'),
    );
  });

  it('merges the selected calendars and caches the day for five minutes', async () => {
    const google = mockGoogleCalendarGateway({ events });
    const usecase = new TodayCalendarEventsUsecase(
      mockGoogleConnectionRepository(
        makeGoogleConnection({
          selectedCalendarIds: ['primary', familyCalendar.id],
        }),
      ),
      google,
    );
    const first = await usecase.eventsForDay(user, tz, now);
    expect(first.map((e) => e.title)).toEqual(['Holiday', 'Standup', 'Dinner']);
    expect(google.listEvents).toHaveBeenCalledTimes(2);

    const soon = new Date(now.getTime() + CALENDAR_EVENTS_CACHE_MS - 1);
    expect(await usecase.eventsForDay(user, tz, soon)).toBe(first);
    expect(google.listEvents).toHaveBeenCalledTimes(2);

    const later = new Date(now.getTime() + CALENDAR_EVENTS_CACHE_MS);
    await usecase.eventsForDay(user, tz, later);
    expect(google.listEvents).toHaveBeenCalledTimes(4);
  });

  it('keeps the other calendars when one fails, and never throws', async () => {
    const google = mockGoogleCalendarGateway({ events });
    google.listEvents.mockImplementation(async (_t, calendarId) => {
      if (calendarId === 'primary') throw new GoogleApiError('404', null, 404);
      return events[familyCalendar.id] ?? [];
    });
    const usecase = new TodayCalendarEventsUsecase(
      mockGoogleConnectionRepository(
        makeGoogleConnection({
          selectedCalendarIds: ['primary', familyCalendar.id],
        }),
      ),
      google,
    );
    expect(
      (await usecase.eventsForDay(user, tz, now)).map((e) => e.title),
    ).toEqual(['Dinner']);
    // A partial answer is not cached: the next call asks again.
    await usecase.eventsForDay(user, tz, now);
    expect(google.listEvents).toHaveBeenCalledTimes(4);

    // A dead grant: no events, no exception (the brief still goes out).
    google.refreshAccessToken.mockRejectedValue(
      new GoogleAuthError('invalid_grant'),
    );
    const expired = new TodayCalendarEventsUsecase(
      mockGoogleConnectionRepository(
        makeGoogleConnection({ accessToken: null, accessTokenExpiresAt: null }),
      ),
      google,
    );
    expect(await expired.eventsForDay(user, tz, now)).toEqual([]);
  });
});
