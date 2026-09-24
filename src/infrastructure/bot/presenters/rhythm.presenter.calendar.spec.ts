import { BRIEF_MAX_EVENTS, presentBrief } from './rhythm.presenter';
import type { MorningBrief } from '@domain/rhythm';
import type { CalendarEvent } from '@domain/integrations/google-calendar';
import { makeTask } from '@test/factories';

const tz = 'Asia/Tashkent';
const event = (
  id: string,
  title: string,
  startZ: string,
  endZ: string,
  allDay = false,
): CalendarEvent => ({
  id,
  calendarId: 'primary',
  title,
  allDay,
  start: new Date(startZ),
  end: new Date(endZ),
  location: null,
});

const base: MorningBrief = {
  kind: 'brief',
  chatId: 42,
  timezone: tz,
  now: new Date('2026-09-24T03:00:00Z'),
  firstName: 'Izzat',
  today: [
    makeTask({
      description: 'Dentist',
      scheduledAt: new Date('2026-09-24T09:00:00Z'),
    }),
  ],
  overdue: [],
  inbox: [],
  inboxCount: 0,
  scheduled: true,
};

describe('presentBrief: Calendar block', () => {
  it('lists the events in the profile zone after Today, all-day first, unnumbered', () => {
    const reply = presentBrief({
      ...base,
      calendarEvents: [
        event(
          'h',
          'Holiday <3',
          '2026-09-23T19:00:00Z',
          '2026-09-24T19:00:00Z',
          true,
        ),
        event('s', 'Standup', '2026-09-24T04:30:00Z', '2026-09-24T04:45:00Z'),
      ],
    });
    const today = reply.html.indexOf('<b>Today</b>');
    const calendar = reply.html.indexOf('📅 <b>Calendar</b> · 2');
    expect(today).toBeGreaterThan(-1);
    expect(calendar).toBeGreaterThan(today);
    expect(reply.html).toContain('• <b>All day</b> Holiday &lt;3');
    expect(reply.html).toContain('• <b>09:30–09:45</b> Standup');
    // Tasks keep their numbers; events get none.
    expect(reply.html).toContain('1. <b>14:00</b> Dentist');
    expect(reply.html).not.toContain('2. ');
  });

  it('is absent without events and caps a long day', () => {
    expect(presentBrief(base).html).not.toContain('Calendar');
    const many = Array.from({ length: BRIEF_MAX_EVENTS + 3 }, (_, i) =>
      event(
        `e${i}`,
        `Event ${i}`,
        `2026-09-24T0${Math.min(i, 9)}:00:00Z`,
        `2026-09-24T0${Math.min(i, 9)}:30:00Z`,
      ),
    );
    const html = presentBrief({ ...base, calendarEvents: many }).html;
    expect(html).toContain(`📅 <b>Calendar</b> · ${BRIEF_MAX_EVENTS + 3}`);
    expect(html).toContain('…and 3 more');
  });
});
