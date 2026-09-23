import { formatInTimeZone } from 'date-fns-tz';
import { seriesEnd } from './recurrence';
import {
  TaskStatus,
  type Priority,
  type Recurrence,
  type Task,
} from '@domain/task';

/**
 * RFC 5545 calendar for the private feed. Pure: the caller passes the
 * tasks and `now`. Pending reminders only (todos have no time; done ones
 * leave the calendar like they leave Today).
 *
 * One-off reminders are written in UTC, which every client reads the same
 * way. Repeating ones use `TZID=<IANA zone>` so "every day at 09:00" stays
 * at 09:00 across DST; Google and Apple Calendar resolve IANA ids without a
 * VTIMEZONE block.
 */
export type CalendarInput = {
  name: string;
  tasks: Task[];
  /** categoryId → name, for CATEGORIES. */
  categoryNames: Map<string, string>;
  now: Date;
};

/** Each reminder shows as a short block; Remy itself does the pinging. */
const EVENT_DURATION = 'PT15M';
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const PRIORITY: Record<Priority, number> = { high: 1, normal: 5, low: 9 };

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, String.raw`\;`)
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Lines longer than 75 octets continue on the next line after CRLF and a
 * space (RFC 5545 §3.1). Splits between characters, never inside UTF-8.
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, 'utf8');
    // The first line holds 75 octets; continuations 74 (the space counts).
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const utcStamp = (date: Date) =>
  formatInTimeZone(date, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
const localStamp = (date: Date, tz: string) =>
  formatInTimeZone(date, tz, "yyyyMMdd'T'HHmmss");
const dateStamp = (date: Date, tz: string) =>
  formatInTimeZone(date, tz, 'yyyyMMdd');

/**
 * RRULE value for a series. A "× N times" series is written as UNTIL its
 * last occurrence: DTSTART is the current occurrence, not the first, so a
 * COUNT would over-count.
 */
export function toRRule(
  recurrence: Recurrence,
  timezone = 'UTC',
  /** All-day series have a DATE DTSTART, so UNTIL must be a DATE too. */
  allDay = false,
): string {
  const n = Math.max(1, Math.floor(recurrence.interval ?? 1));
  const interval = n > 1 ? `;INTERVAL=${n}` : '';
  let rule: string;
  switch (recurrence.type) {
    case 'daily':
      rule = 'FREQ=DAILY';
      break;
    case 'weekdays':
      rule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
      break;
    case 'weekly': {
      const days = [...new Set(recurrence.byWeekday ?? [])]
        .filter((d) => d >= 0 && d <= 6)
        .sort((a, b) => a - b)
        .map((d) => WEEKDAYS[d]);
      rule = `FREQ=WEEKLY${interval}${days.length ? `;BYDAY=${days.join(',')}` : ''}`;
      break;
    }
    case 'monthly':
      rule = `FREQ=MONTHLY${interval}${recurrence.lastDayOfMonth ? ';BYMONTHDAY=-1' : ''}`;
      break;
    case 'yearly':
      rule = `FREQ=YEARLY${interval}`;
      break;
    case 'every_n_days': {
      const days = Math.max(1, Math.floor(recurrence.intervalDays ?? 1));
      rule = `FREQ=DAILY${days > 1 ? `;INTERVAL=${days}` : ''}`;
      break;
    }
  }
  const end = seriesEnd(recurrence, timezone);
  if (!end) return rule;
  return `${rule};UNTIL=${allDay ? dateStamp(end, timezone) : utcStamp(end)}`;
}

function eventLines(
  task: Task,
  start: Date,
  input: CalendarInput,
  extra: string[],
  /** An all-day task is a whole-day event (a snoozed occurrence is not). */
  wholeDay = false,
): string[] {
  const category = task.categoryId
    ? input.categoryNames.get(task.categoryId)
    : undefined;
  const dtstart = wholeDay
    ? `DTSTART;VALUE=DATE:${dateStamp(start, task.timezone)}`
    : task.recurrence
      ? `DTSTART;TZID=${task.timezone}:${localStamp(start, task.timezone)}`
      : `DTSTART:${utcStamp(start)}`;
  return [
    'BEGIN:VEVENT',
    `UID:${task.id}@remy`,
    `DTSTAMP:${utcStamp(input.now)}`,
    `LAST-MODIFIED:${utcStamp(task.updatedAt)}`,
    dtstart,
    `DURATION:${wholeDay ? 'P1D' : EVENT_DURATION}`,
    `SUMMARY:${escapeText(task.description)}`,
    ...(task.notes ? [`DESCRIPTION:${escapeText(task.notes)}`] : []),
    ...(category ? [`CATEGORIES:${escapeText(category)}`] : []),
    `PRIORITY:${PRIORITY[task.priority]}`,
    ...extra,
    'END:VEVENT',
  ];
}

export function buildCalendar(input: CalendarInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Remy//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(input.name)}`,
    // Ask subscribers to refresh often; Google decides for itself anyway.
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];

  const tasks = input.tasks
    .filter((t) => t.status === TaskStatus.Pending && t.scheduledAt !== null)
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime());

  for (const task of tasks) {
    const series = task.scheduledAt!;
    if (!task.recurrence) {
      // A one-off snooze moves scheduledAt itself; snoozedUntil is a fallback.
      const start = task.snoozedUntil ?? series;
      lines.push(
        ...eventLines(
          task,
          start,
          input,
          [],
          task.allDay && !task.snoozedUntil,
        ),
      );
      continue;
    }
    lines.push(
      ...eventLines(
        task,
        series,
        input,
        [`RRULE:${toRRule(task.recurrence, task.timezone, task.allDay)}`],
        task.allDay,
      ),
    );
    // A snoozed occurrence: override just that date, the series stays.
    if (task.snoozedUntil) {
      const recurrenceId = task.allDay
        ? `RECURRENCE-ID;VALUE=DATE:${dateStamp(series, task.timezone)}`
        : `RECURRENCE-ID;TZID=${task.timezone}:${localStamp(series, task.timezone)}`;
      lines.push(...eventLines(task, task.snoozedUntil, input, [recurrenceId]));
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
