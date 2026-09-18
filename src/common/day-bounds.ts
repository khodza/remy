import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/** [start, end) of the calendar day containing `now` in `timezone`, as instants. */
export function dayBoundsInZone(
  now: Date,
  timezone: string,
): { start: Date; end: Date } {
  const zonedStart = startOfDay(toZonedTime(now, timezone));
  return {
    start: fromZonedTime(zonedStart, timezone),
    end: fromZonedTime(addDays(zonedStart, 1), timezone),
  };
}
