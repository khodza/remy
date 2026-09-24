import type { User } from '@domain/user';
import type { CalendarEvent } from './types';

/**
 * What the morning brief asks for: the events of the user's local day.
 * Returns [] when no account is connected; never throws (a Google outage
 * must not cost the owner the brief).
 */
export interface CalendarEventsSource {
  eventsForDay(
    user: Pick<User, 'id'>,
    timezone: string,
    now: Date,
  ): Promise<CalendarEvent[]>;
}
