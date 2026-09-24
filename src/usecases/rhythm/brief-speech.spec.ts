import type { MorningBrief } from '@domain/rhythm';
import { makeTask } from '@test/factories';
import { briefSpeechText } from './brief-speech';

const tz = 'Asia/Tashkent';
const brief: MorningBrief = {
  kind: 'brief',
  chatId: 42,
  timezone: tz,
  now: new Date('2026-09-17T03:00:00Z'),
  firstName: 'Izzat',
  today: [
    makeTask({
      description: 'Standup  with <team>',
      scheduledAt: new Date('2026-09-17T04:30:00Z'), // 09:30
    }),
    makeTask({
      description: 'Pay rent',
      scheduledAt: new Date('2026-09-17T04:00:00Z'),
      allDay: true,
    }),
    makeTask({
      description: 'Dentist!',
      scheduledAt: new Date('2026-09-17T10:00:00Z'), // 15:00
    }),
  ],
  overdue: [
    makeTask({
      description: 'Call mom',
      scheduledAt: new Date('2026-09-15T09:00:00Z'),
    }),
  ],
  undelivered: [],
  inbox: [],
  inboxCount: 2,
  scheduled: true,
};

describe('briefSpeechText', () => {
  it('reads the day in order, in the user clock, without markup', () => {
    expect(briefSpeechText(brief, { hour12: false })).toBe(
      "Good morning, Izzat. It's Thursday, 17 September. You have 3 things today. " +
        'At 09:30, Standup with <team>. Any time today, Pay rent. At 15:00, Dentist! ' +
        'One thing is still open from before: Call mom. ' +
        '2 things in the Inbox have no date yet. Have a good day!',
    );
  });

  it('12-hour clock, an empty day, one undelivered reminder', () => {
    const text = briefSpeechText(
      {
        ...brief,
        today: [brief.today[2]!],
        overdue: [],
        undelivered: [makeTask({ description: 'Water plants' })],
        inboxCount: 0,
      },
      { hour12: true },
    );
    expect(text).toContain('You have one thing today. At 3:00 PM, Dentist!');
    expect(text).toContain(
      'One reminder could not be delivered: Water plants.',
    );
    expect(
      briefSpeechText(
        { ...brief, today: [], overdue: [], inboxCount: 0 },
        { hour12: false },
      ),
    ).toContain('Nothing is scheduled for today. Have a good day!');
  });

  it('summarises a long day and many overdue items', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      makeTask({
        description: `Task ${i}`,
        scheduledAt: new Date(Date.UTC(2026, 8, 17, 5, i)),
      }),
    );
    const text = briefSpeechText(
      { ...brief, today: many, overdue: many.slice(0, 5) },
      { hour12: false },
    );
    expect(text).toContain('You have 15 things today.');
    expect(text).toContain('And 3 more.');
    expect(text).toContain(
      '5 things are still open from before: Task 0, Task 1, Task 2, and 2 more.',
    );
  });
});
