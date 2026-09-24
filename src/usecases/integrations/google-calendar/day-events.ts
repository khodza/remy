import { addDays } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type {
  CalendarEvent,
  GoogleCalendarInfo,
  GoogleConnection,
  RawCalendarEvent,
} from '@domain/integrations/google-calendar';
import { PRIMARY_CALENDAR_ID } from './types';

/**
 * The events of one calendar that belong to the user's day [dayStart,
 * dayEnd): cancelled and declined ones are dropped; an all-day event (a
 * `date`, no instant) is placed on local midnight in the user's zone and
 * kept when any of its days is today; a timed one when it overlaps the day.
 */
export function toDayEvents(
  raw: RawCalendarEvent[],
  calendarId: string,
  timezone: string,
  dayStart: Date,
  dayEnd: Date,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const item of raw) {
    if (item.status === 'cancelled' || item.declined) continue;
    const span = eventSpan(item, timezone);
    if (!span) continue;
    if (span.start < dayEnd && span.end > dayStart) {
      events.push({
        id: item.id,
        calendarId,
        title: item.title,
        allDay: span.allDay,
        start: span.start,
        end: span.end,
        location: item.location,
      });
    }
  }
  return events;
}

function eventSpan(
  item: RawCalendarEvent,
  timezone: string,
): { start: Date; end: Date; allDay: boolean } | null {
  if (item.start.date) {
    const start = fromZonedTime(`${item.start.date}T00:00:00`, timezone);
    const end = item.end.date
      ? fromZonedTime(`${item.end.date}T00:00:00`, timezone)
      : addDays(start, 1);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
      return null;
    return { start, end: end > start ? end : addDays(start, 1), allDay: true };
  }
  if (item.start.dateTime) {
    const start = new Date(item.start.dateTime);
    const end = new Date(item.end.dateTime ?? item.start.dateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
      return null;
    return { start, end: end > start ? end : start, allDay: false };
  }
  return null;
}

/**
 * All-day events first, then by start time; an invitation that sits in two
 * selected calendars is shown once.
 */
export function mergeDayEvents(lists: CalendarEvent[][]): CalendarEvent[] {
  const seen = new Set<string>();
  const merged: CalendarEvent[] = [];
  for (const event of lists.flat()) {
    const key = `${event.id}|${event.start.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      a.start.getTime() - b.start.getTime() ||
      a.title.localeCompare(b.title),
  );
}

/** The calendars that feed the brief: the picked ones, else the primary. */
export function calendarIdsOf(
  connection: Pick<GoogleConnection, 'selectedCalendarIds'>,
): string[] {
  return connection.selectedCalendarIds.length > 0
    ? connection.selectedCalendarIds
    : [PRIMARY_CALENDAR_ID];
}

/** Marks each listed calendar as selected (the primary when nothing was picked). */
export function markSelected(
  connection: Pick<GoogleConnection, 'selectedCalendarIds'>,
  calendars: GoogleCalendarInfo[],
): { id: string; summary: string; selected: boolean }[] {
  const picked = new Set(connection.selectedCalendarIds);
  return calendars.map((c) => ({
    id: c.id,
    summary: c.summary,
    selected: picked.size > 0 ? picked.has(c.id) : c.primary,
  }));
}
