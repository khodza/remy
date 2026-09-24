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

/**
 * " (09:00 Berlin time)" when a task was made in another zone than the one
 * the user reads in now and the two clocks differ at that instant; empty
 * otherwise (same zone, same offset, or an all-day task). Appended to the
 * profile-zone time so a moved user can still recognise "the 9 o'clock".
 */
export function zoneHint(
  date: Date,
  taskZone: string,
  userZone: string,
  allDay = false,
): string {
  if (allDay || taskZone === userZone) return '';
  const there = formatInTimeZone(date, taskZone, 'HH:mm');
  if (there === formatInTimeZone(date, userZone, 'HH:mm')) return '';
  const city = (taskZone.split('/').pop() ?? taskZone).replace(/_/g, ' ');
  return ` <i>(${there} ${city} time)</i>`;
}
