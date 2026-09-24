import { DigestBuilder } from './digest-builder';
import type { CalendarEventsSource } from '@domain/integrations/google-calendar';
import { makeUser, mockTaskRepository } from '@test/factories';

const tz = 'Asia/Tashkent';
const user = makeUser({ id: 'user-1', timezone: tz });
const now = new Date('2026-09-24T03:00:00Z');

describe('DigestBuilder + Google Calendar', () => {
  it('asks the events source for the same user, zone and moment', async () => {
    const events: CalendarEventsSource = {
      eventsForDay: jest.fn(async () => [
        {
          id: 'e1',
          calendarId: 'primary',
          title: 'Standup',
          allDay: false,
          start: new Date('2026-09-24T04:30:00Z'),
          end: new Date('2026-09-24T04:45:00Z'),
          location: null,
        },
      ]),
    };
    const brief = await new DigestBuilder(
      mockTaskRepository(),
      events,
    ).buildBrief(user, tz, now, true);
    expect(events.eventsForDay).toHaveBeenCalledWith(user, tz, now);
    expect(brief.calendarEvents?.map((e) => e.title)).toEqual(['Standup']);
  });

  it('leaves the field out without a source or without events', async () => {
    const none = await new DigestBuilder(mockTaskRepository()).buildBrief(
      user,
      tz,
      now,
      true,
    );
    expect(none.calendarEvents).toBeUndefined();
    const empty = await new DigestBuilder(mockTaskRepository(), {
      eventsForDay: async () => [],
    }).buildBrief(user, tz, now, false);
    expect(empty.calendarEvents).toBeUndefined();
  });
});
