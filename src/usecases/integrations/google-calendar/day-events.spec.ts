import {
  calendarIdsOf,
  markSelected,
  mergeDayEvents,
  toDayEvents,
} from './day-events';
import { dayBoundsInZone } from '@common/day-bounds';
import {
  familyCalendar,
  primaryCalendar,
  rawEvent,
} from '@test/google-factories';

const tz = 'Asia/Tashkent'; // UTC+5
const now = new Date('2026-09-24T03:00:00Z'); // Thu 08:00 local
const { start, end } = dayBoundsInZone(now, tz); // 23 Sep 19:00Z … 24 Sep 19:00Z

describe('toDayEvents', () => {
  it('keeps timed events that overlap the local day, drops cancelled and declined', () => {
    const events = toDayEvents(
      [
        rawEvent({ id: 'in', title: 'Standup' }),
        rawEvent({ id: 'cancelled', status: 'cancelled' }),
        rawEvent({ id: 'declined', declined: true }),
        rawEvent({
          id: 'yesterday',
          start: { dateTime: '2026-09-23T18:00:00+05:00' },
          end: { dateTime: '2026-09-23T19:00:00+05:00' },
        }),
        rawEvent({
          id: 'overnight',
          title: 'Night shift',
          start: { dateTime: '2026-09-23T22:00:00+05:00' },
          end: { dateTime: '2026-09-24T06:00:00+05:00' },
        }),
        rawEvent({ id: 'broken', start: { dateTime: 'not a date' } }),
        rawEvent({ id: 'empty', start: {}, end: {} }),
      ],
      'primary',
      tz,
      start,
      end,
    );
    expect(events.map((e) => e.id)).toEqual(['in', 'overnight']);
    expect(events[0]).toEqual({
      id: 'in',
      calendarId: 'primary',
      title: 'Standup',
      allDay: false,
      start: new Date('2026-09-24T04:00:00Z'),
      end: new Date('2026-09-24T05:00:00Z'),
      location: null,
    });
  });

  it('places all-day events on local midnight and keeps multi-day ones that cover today', () => {
    const events = toDayEvents(
      [
        rawEvent({
          id: 'today',
          title: 'Holiday',
          start: { date: '2026-09-24' },
          end: { date: '2026-09-25' },
        }),
        rawEvent({
          id: 'span',
          title: 'Conference',
          start: { date: '2026-09-22' },
          end: { date: '2026-09-26' },
        }),
        // Ends today (exclusive end): it was yesterday's.
        rawEvent({
          id: 'ended',
          start: { date: '2026-09-23' },
          end: { date: '2026-09-24' },
        }),
        rawEvent({ id: 'no-end', start: { date: '2026-09-24' }, end: {} }),
        rawEvent({ id: 'bad', start: { date: 'nope' }, end: {} }),
      ],
      'primary',
      tz,
      start,
      end,
    );
    expect(events.map((e) => e.id)).toEqual(['today', 'span', 'no-end']);
    expect(events[0]).toMatchObject({
      allDay: true,
      start: new Date('2026-09-23T19:00:00Z'),
      end: new Date('2026-09-24T19:00:00Z'),
    });
    expect(events[2]?.end).toEqual(new Date('2026-09-24T19:00:00Z'));
  });
});

describe('mergeDayEvents', () => {
  it('puts all-day first, then by start, and shows a shared invitation once', () => {
    const timed = (id: string, hour: number, title = id) => ({
      id,
      calendarId: 'primary',
      title,
      allDay: false,
      start: new Date(`2026-09-24T0${hour}:00:00Z`),
      end: new Date(`2026-09-24T0${hour + 1}:00:00Z`),
      location: null,
    });
    const allDay = {
      ...timed('h', 0, 'Holiday'),
      allDay: true,
      start: new Date('2026-09-23T19:00:00Z'),
    };
    const merged = mergeDayEvents([
      [timed('b', 6), timed('a', 4)],
      [{ ...timed('a', 4), calendarId: 'family' }, allDay],
    ]);
    expect(merged.map((e) => e.id)).toEqual(['h', 'a', 'b']);
  });
});

describe('calendar selection', () => {
  it('defaults to the primary calendar', () => {
    expect(calendarIdsOf({ selectedCalendarIds: [] })).toEqual(['primary']);
    expect(calendarIdsOf({ selectedCalendarIds: ['x'] })).toEqual(['x']);
    expect(
      markSelected({ selectedCalendarIds: [] }, [
        primaryCalendar,
        familyCalendar,
      ]),
    ).toEqual([
      { id: primaryCalendar.id, summary: 'Owner', selected: true },
      { id: familyCalendar.id, summary: 'Family', selected: false },
    ]);
    expect(
      markSelected({ selectedCalendarIds: [familyCalendar.id] }, [
        primaryCalendar,
        familyCalendar,
      ]).map((c) => c.selected),
    ).toEqual([false, true]);
  });
});
