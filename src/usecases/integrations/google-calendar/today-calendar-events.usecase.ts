import { Inject, Injectable, Logger } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { dayBoundsInZone } from '@common/day-bounds';
import type {
  CalendarEvent,
  CalendarEventsSource,
  GoogleCalendarGateway,
  GoogleConnectionRepository,
} from '@domain/integrations/google-calendar';
import type { User } from '@domain/user';
import { ensureAccessToken } from './access-token';
import { calendarIdsOf, mergeDayEvents, toDayEvents } from './day-events';
import { CALENDAR_EVENTS_CACHE_MS } from './types';

type CacheEntry = { at: Date; events: CalendarEvent[] };

/**
 * The day's events for the morning brief and /today. Never throws: without
 * a connection, or when Google is down, the brief simply has no calendar
 * block. Results are kept for five minutes per user, day and calendar set
 * (the brief and /today within minutes of each other cost one round trip).
 */
@Injectable()
export class TodayCalendarEventsUsecase implements CalendarEventsSource {
  private readonly logger = new Logger(TodayCalendarEventsUsecase.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(Domain.Integrations.GoogleConnectionRepository)
    private readonly connections: GoogleConnectionRepository,
    @Inject(Domain.Integrations.GoogleCalendarGateway)
    private readonly google: GoogleCalendarGateway,
  ) {}

  public async eventsForDay(
    user: Pick<User, 'id'>,
    timezone: string,
    now: Date,
  ): Promise<CalendarEvent[]> {
    try {
      if (!this.google.isConfigured()) return [];
      const connection = await this.connections.findByUserId(user.id);
      if (!connection) return [];

      const { start, end } = dayBoundsInZone(now, timezone);
      const calendarIds = calendarIdsOf(connection);
      const key = [
        user.id,
        start.toISOString(),
        timezone,
        calendarIds.join(','),
        connection.connectedAt.getTime(),
      ].join('|');
      const cached = this.cache.get(key);
      if (
        cached &&
        now.getTime() - cached.at.getTime() < CALENDAR_EVENTS_CACHE_MS
      )
        return cached.events;

      const token = await ensureAccessToken(
        connection,
        this.google,
        this.connections,
        now,
      );
      let failed = false;
      const lists = await Promise.all(
        calendarIds.map(async (calendarId) => {
          try {
            const raw = await this.google.listEvents(
              token,
              calendarId,
              start,
              end,
            );
            return toDayEvents(raw, calendarId, timezone, start, end);
          } catch (error) {
            // One calendar gone or unreachable must not hide the others.
            failed = true;
            this.logger.warn(
              `Calendar ${calendarId}: ${(error as Error)?.message ?? error}`,
            );
            return [];
          }
        }),
      );
      const events = mergeDayEvents(lists);
      if (!failed) this.remember(key, { at: now, events });
      return events;
    } catch (error) {
      this.logger.warn(
        `Calendar events skipped: ${(error as Error)?.message ?? error}`,
      );
      return [];
    }
  }

  private remember(key: string, entry: CacheEntry): void {
    for (const [k, v] of this.cache) {
      if (entry.at.getTime() - v.at.getTime() >= CALENDAR_EVENTS_CACHE_MS)
        this.cache.delete(k);
    }
    this.cache.set(key, entry);
  }
}
