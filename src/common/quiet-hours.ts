import { addDays, set } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

export type QuietHoursRule = {
  enabled: boolean;
  /** "HH:mm" local, start of the muted window. */
  from: string;
  /** "HH:mm" local, end of the muted window (exclusive). */
  to: string;
};

function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Whether `now` falls in the muted window, on the wall clock of `timezone`. */
export function isInQuietHours(
  now: Date,
  timezone: string,
  rule: QuietHoursRule,
): boolean {
  if (!rule.enabled) return false;
  const from = toMinutes(rule.from);
  const to = toMinutes(rule.to);
  if (from === to) return false;
  const local = toMinutes(formatInTimeZone(now, timezone, 'HH:mm'));
  // 23:00 → 07:00 wraps midnight; 13:00 → 14:00 does not.
  return from < to ? local >= from && local < to : local >= from || local < to;
}

/** The next moment the window ends (local "to" time), strictly after `now`. */
export function quietHoursEnd(
  now: Date,
  timezone: string,
  rule: QuietHoursRule,
): Date {
  const minutes = toMinutes(rule.to);
  const zonedNow = toZonedTime(now, timezone);
  let candidate = set(zonedNow, {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
    seconds: 0,
    milliseconds: 0,
  });
  if (candidate.getTime() <= zonedNow.getTime())
    candidate = addDays(candidate, 1);
  return fromZonedTime(candidate, timezone);
}
