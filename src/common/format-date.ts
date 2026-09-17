import { formatInTimeZone } from 'date-fns-tz';

/**
 * The one way a date is shown to the user in Telegram: in the task's (or
 * user's) IANA timezone, 24-hour clock. Never use plain date-fns `format`
 * for user-facing text: it formats in the server's zone.
 */
export function formatForUser(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'EEE d MMM yyyy, HH:mm');
}

/** Short form for lists: "Thu 16 Apr, 11:00". */
export function formatForUserShort(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'EEE d MMM, HH:mm');
}
