import { formatInTimeZone } from 'date-fns-tz';

/**
 * The one way a date is shown to the user in Telegram: in the user's IANA
 * timezone (the zone they live in now), 24-hour clock. An all-day task is a
 * date only. Never use plain date-fns `format` for user-facing text: it
 * formats in the server's zone.
 */
export function formatForUser(
  date: Date,
  timezone: string,
  allDay = false,
): string {
  return allDay
    ? `${formatInTimeZone(date, timezone, 'EEE d MMM yyyy')} (all day)`
    : formatInTimeZone(date, timezone, 'EEE d MMM yyyy, HH:mm');
}

/** Short form for lists: "Thu 16 Apr, 11:00" or "Thu 16 Apr (all day)". */
export function formatForUserShort(
  date: Date,
  timezone: string,
  allDay = false,
): string {
  return allDay
    ? `${formatInTimeZone(date, timezone, 'EEE d MMM')} (all day)`
    : formatInTimeZone(date, timezone, 'EEE d MMM, HH:mm');
}

/** The clock part alone: "11:00", or "all day". */
export function formatClockForUser(
  date: Date,
  timezone: string,
  allDay = false,
): string {
  return allDay ? 'all day' : formatInTimeZone(date, timezone, 'HH:mm');
}
