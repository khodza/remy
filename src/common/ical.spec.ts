import { buildCalendar, escapeText, foldLine, toRRule } from './ical';
import { TaskStatus } from '@domain/task';
import { makeTask } from '@test/factories';

const NOW = new Date('2026-09-19T10:00:00Z');

describe('ical', () => {
  it('escapes text and folds long lines at 75 octets without splitting characters', () => {
    // String.raw: what you see is the exact output, backslashes included.
    expect(escapeText('Call mom; bring cake, milk\nand \\ tea')).toBe(
      String.raw`Call mom\; bring cake\, milk\nand \\ tea`,
    );
    const line = `SUMMARY:${'Позвонить маме '.repeat(10)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => Buffer.byteLength(p, 'utf8') <= 75)).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it.each([
    [{ type: 'daily' }, 'FREQ=DAILY'],
    [{ type: 'weekdays' }, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
    [{ type: 'weekly', byWeekday: [4, 1] }, 'FREQ=WEEKLY;BYDAY=MO,TH'],
    [{ type: 'weekly', interval: 2 }, 'FREQ=WEEKLY;INTERVAL=2'],
    [{ type: 'monthly', lastDayOfMonth: true }, 'FREQ=MONTHLY;BYMONTHDAY=-1'],
    [{ type: 'yearly' }, 'FREQ=YEARLY'],
    [{ type: 'every_n_days', intervalDays: 3 }, 'FREQ=DAILY;INTERVAL=3'],
    [
      { type: 'daily', until: new Date('2026-12-31T19:00:00Z') },
      'FREQ=DAILY;UNTIL=20261231T190000Z',
    ],
    // × 3 from the anchor: UNTIL the third occurrence (DTSTART may be later).
    [
      {
        type: 'daily',
        count: 3,
        anchorAt: new Date('2026-09-16T09:00:00Z'),
      },
      'FREQ=DAILY;UNTIL=20260918T090000Z',
    ],
  ] as const)('RRULE for %j', (recurrence, rule) => {
    expect(toRRule(recurrence as never)).toBe(rule);
  });

  it('writes one-offs in UTC, series in the task zone, and a snoozed occurrence as an override', () => {
    const oneOff = makeTask({
      id: 'a1',
      description: 'Dentist',
      scheduledAt: new Date('2026-09-20T05:00:00Z'),
      timezone: 'Asia/Tashkent',
      categoryId: 'c-health',
      priority: 'high',
    });
    const series = makeTask({
      id: 'b2',
      description: 'Standup',
      scheduledAt: new Date('2026-09-21T04:30:00Z'),
      snoozedUntil: new Date('2026-09-21T05:00:00Z'),
      timezone: 'Asia/Tashkent',
      recurrence: { type: 'weekdays' },
    });
    const todo = makeTask({ id: 'c3', scheduledAt: null });
    const done = makeTask({
      id: 'd4',
      scheduledAt: new Date('2026-09-19T05:00:00Z'),
      status: TaskStatus.Completed,
    });

    const ics = buildCalendar({
      name: 'Remy',
      tasks: [series, todo, done, oneOff],
      categoryNames: new Map([['c-health', 'Health']]),
      now: NOW,
    });

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toContain('c3@remy');
    expect(ics).not.toContain('d4@remy');
    expect(ics).toContain('UID:a1@remy\r\nDTSTAMP:20260919T100000Z');
    expect(ics).toContain('DTSTART:20260920T050000Z');
    expect(ics).toContain('CATEGORIES:Health');
    expect(ics).toContain('PRIORITY:1');
    expect(ics).toContain('DTSTART;TZID=Asia/Tashkent:20260921T093000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(ics).toContain('RECURRENCE-ID;TZID=Asia/Tashkent:20260921T093000');
    expect(ics).toContain('DTSTART;TZID=Asia/Tashkent:20260921T100000');
    // Soonest first: the one-off (20th) before the series (21st).
    expect(ics.indexOf('a1@remy')).toBeLessThan(ics.indexOf('b2@remy'));
  });

  it('writes all-day tasks as whole-day events, with a DATE UNTIL on a series', () => {
    const birthday = makeTask({
      id: 'd1',
      description: 'Mom birthday',
      scheduledAt: new Date('2026-09-20T04:00:00Z'), // 09:00 Tashkent
      timezone: 'Asia/Tashkent',
      allDay: true,
    });
    const weekly = makeTask({
      id: 'd2',
      description: 'Bins',
      scheduledAt: new Date('2026-09-21T04:00:00Z'),
      timezone: 'Asia/Tashkent',
      allDay: true,
      recurrence: {
        type: 'weekly',
        count: 2,
        anchorAt: new Date('2026-09-21T04:00:00Z'),
      },
    });
    const ics = buildCalendar({
      name: 'Remy',
      tasks: [birthday, weekly],
      categoryNames: new Map(),
      now: new Date('2026-09-19T00:00:00Z'),
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260920\r\nDURATION:P1D');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;UNTIL=20260928');
  });
});
