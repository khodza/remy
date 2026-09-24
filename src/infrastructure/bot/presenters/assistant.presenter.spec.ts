import { presentAssistantResult } from './assistant.presenter';
import { TaskStatus } from '@domain/task';
import { makeTask } from '@test/factories';

const tz = 'Asia/Tashkent';
const now = new Date('2026-09-18T09:47:00Z'); // Fri 14:47 local
const buttons = (reply: ReturnType<typeof presentAssistantResult>) =>
  (reply.keyboard?.inline_keyboard ?? [])
    .flat()
    .map((b) => [b.text, 'callback_data' in b ? b.callback_data : undefined]);

describe('presentAssistantResult', () => {
  it('created (one): full block in the user zone with an Undo button; user text is escaped', () => {
    const reply = presentAssistantResult(
      {
        kind: 'created',
        undoId: 'u1',
        tasks: [
          makeTask({
            description: 'Email <boss> & co',
            scheduledAt: new Date('2026-09-19T05:00:00Z'),
            timezone: tz,
            recurrence: { type: 'weekly', byWeekday: [1, 4] },
            leadMinutes: 30,
            priority: 'high',
          }),
        ],
      },
      tz,
      now,
    );
    expect(reply.html).toContain('Email &lt;boss&gt; &amp; co');
    expect(reply.html).toContain('Sat 19 Sep 2026, 10:00');
    expect(reply.html).toContain('Repeats every Mon and Thu');
    expect(reply.html).toContain('Heads-up 30 min before');
    expect(reply.html).toContain('High priority');
    expect(buttons(reply)).toEqual([['↩ Undo', 'undo:u1']]);
  });

  it('created (many): a numbered list, todos say "no date", one Undo all', () => {
    const reply = presentAssistantResult(
      {
        kind: 'created',
        undoId: 'u2',
        tasks: [
          makeTask({ description: 'Buy milk', scheduledAt: null }),
          makeTask({
            description: 'Call mom',
            scheduledAt: new Date('2026-09-18T12:00:00Z'),
            timezone: tz,
          }),
        ],
      },
      tz,
      now,
    );
    expect(reply.html).toContain('Saved 2 things');
    expect(reply.html).toContain('1. <b>Buy milk</b> · no date');
    expect(reply.html).toContain('2. <b>Call mom</b> · Fri 18 Sep, 17:00');
    expect(buttons(reply)).toEqual([['↩ Undo all', 'undo:u2']]);
  });

  it('completed: a recurring task shows when it comes back', () => {
    const reply = presentAssistantResult(
      {
        kind: 'completed',
        undoId: 'u3',
        tasks: [
          makeTask({
            description: 'Gym',
            scheduledAt: new Date('2026-09-21T02:00:00Z'),
            timezone: tz,
            recurrence: { type: 'daily' },
          }),
          makeTask({ description: 'Dentist', status: TaskStatus.Completed }),
        ],
      },
      tz,
      now,
    );
    expect(reply.html).toContain('✅ Gym <i>(next: Mon 21 Sep, 07:00)</i>');
    expect(reply.html).toContain('✅ Dentist');
  });

  it('an all-day task is shown as a date only, with a repeat count', () => {
    const allDay = makeTask({
      description: 'Pay rent',
      scheduledAt: new Date('2026-09-25T04:00:00Z'), // Fri 09:00 Tashkent
      timezone: tz,
      allDay: true,
      recurrence: { type: 'monthly', count: 3 },
    });
    const one = presentAssistantResult(
      { kind: 'created', undoId: 'u', tasks: [allDay] },
      tz,
      now,
    );
    expect(one.html).toContain('📅 Fri 25 Sep 2026 (all day)');
    expect(one.html).toContain('Repeats every month × 3 times');
    expect(one.html).not.toContain('09:00');

    const many = presentAssistantResult(
      { kind: 'created', undoId: 'u', tasks: [allDay, allDay] },
      tz,
      now,
    );
    expect(many.html).toContain('<b>Pay rent</b> · Fri 25 Sep (all day)');

    // In the agenda, "all day" takes the clock's place and it is not late
    // during its own day.
    const agenda = presentAssistantResult(
      {
        kind: 'agenda',
        range: 'week',
        search: null,
        list: null,
        tasks: [
          makeTask({
            ...allDay,
            scheduledAt: new Date('2026-09-18T04:00:00Z'), // today
          }),
        ],
      },
      tz,
      now,
    );
    expect(agenda.html).toContain('1. <b>all day</b> Pay rent 🔁');
    expect(agenda.html).not.toContain('late');
  });

  it('every time is shown in the profile zone, whatever zone the task was made in', () => {
    const berlinTask = makeTask({
      description: 'Standup',
      scheduledAt: new Date('2026-09-21T07:00:00Z'), // 09:00 Berlin, 12:00 Tashkent
      timezone: 'Europe/Berlin',
      recurrence: { type: 'daily' },
    });
    const completed = presentAssistantResult(
      { kind: 'completed', undoId: 'u', tasks: [berlinTask] },
      tz,
      now,
    );
    expect(completed.html).toContain('(next: Mon 21 Sep, 12:00)');
    const moved = presentAssistantResult(
      { kind: 'rescheduled', undoId: 'u', tasks: [berlinTask], skipped: [] },
      tz,
      now,
    );
    expect(moved.html).toContain('Mon 21 Sep, 12:00');

    // Across the DST switch the profile zone's offset changes, the task
    // zone's does not: 09:00 Tashkent is 06:00 Berlin in summer and 05:00
    // in winter. Both read correctly in Berlin.
    const tashkentDaily = (at: string) =>
      makeTask({
        description: 'Pills',
        scheduledAt: new Date(at),
        timezone: 'Asia/Tashkent',
        recurrence: { type: 'daily' },
      });
    const summer = presentAssistantResult(
      {
        kind: 'completed',
        undoId: 'u',
        tasks: [tashkentDaily('2026-10-24T04:00:00Z')],
      },
      'Europe/Berlin',
      now,
    );
    const winter = presentAssistantResult(
      {
        kind: 'completed',
        undoId: 'u',
        tasks: [tashkentDaily('2026-10-26T04:00:00Z')],
      },
      'Europe/Berlin',
      now,
    );
    expect(summer.html).toContain('Sat 24 Oct, 06:00');
    expect(winter.html).toContain('Mon 26 Oct, 05:00');
  });

  it('rescheduled: new time, "this time only" for a snoozed series, skipped ones explained', () => {
    const reply = presentAssistantResult(
      {
        kind: 'rescheduled',
        undoId: 'u4',
        tasks: [
          makeTask({
            description: 'Gym',
            timezone: tz,
            scheduledAt: new Date('2026-09-18T02:00:00Z'),
            snoozedUntil: new Date('2026-09-18T13:00:00Z'),
            recurrence: { type: 'daily' },
          }),
        ],
        skipped: [makeTask({ description: 'Old thing' })],
      },
      tz,
      now,
    );
    expect(reply.html).toContain(
      '⏭ Gym → <b>Fri 18 Sep, 18:00</b> <i>(this time only)</i>',
    );
    expect(reply.html).toContain('Old thing: that time is not in the future');
  });

  it('agenda: day headers, numbering that replies can use, overdue marked, empty state', () => {
    const reply = presentAssistantResult(
      {
        kind: 'agenda',
        range: 'week',
        search: null,
        list: null,
        tasks: [
          makeTask({
            description: 'Pay bill',
            timezone: tz,
            scheduledAt: new Date('2026-09-18T06:00:00Z'),
          }),
          makeTask({
            description: 'Call mom',
            timezone: tz,
            scheduledAt: new Date('2026-09-18T14:00:00Z'),
            recurrence: { type: 'weekly' },
          }),
          makeTask({
            description: 'Dentist',
            timezone: tz,
            scheduledAt: new Date('2026-09-19T05:00:00Z'),
          }),
        ],
      },
      tz,
      now,
    );
    expect(reply.html).toContain('<b>Next 7 days</b> · 3');
    expect(reply.html).toContain(
      '<u>Fri 18 Sep</u>\n1. <b>11:00</b> Pay bill 🔴 3 h late\n2. <b>19:00</b> Call mom 🔁',
    );
    expect(reply.html).toContain('<u>Sat 19 Sep</u>\n3. <b>10:00</b> Dentist');
    expect(reply.keyboard).toBeUndefined();

    expect(
      presentAssistantResult(
        { kind: 'agenda', range: 'today', search: null, list: null, tasks: [] },
        tz,
        now,
      ).html,
    ).toContain('Nothing here');
  });

  it('lists: the confirmation names the list, and a list agenda is titled by it', () => {
    const milk = makeTask({
      description: 'Milk',
      scheduledAt: null,
      list: 'shopping',
    });
    const created = presentAssistantResult(
      { kind: 'created', undoId: 'u', tasks: [milk] },
      tz,
      now,
    );
    expect(created.html).toContain('🗂 On your shopping list');
    const agenda = presentAssistantResult(
      {
        kind: 'agenda',
        range: 'all',
        search: null,
        list: 'shopping',
        tasks: [milk],
      },
      tz,
      now,
    );
    expect(agenda.html).toContain('📋 <b>🗂 Shopping list</b> · 1');
    const empty = presentAssistantResult(
      {
        kind: 'agenda',
        range: 'today',
        search: null,
        list: 'shopping',
        tasks: [],
      },
      tz,
      now,
    );
    expect(empty.html).toContain('🗂 Shopping list · Today');
  });

  it('question: options become tappable answers; chat text is escaped', () => {
    const q = presentAssistantResult(
      {
        kind: 'question',
        question: 'Morning or evening?',
        options: ['05:00', '17:00'],
      },
      tz,
      now,
    );
    expect(buttons(q)).toEqual([
      ['05:00', 'ans:0'],
      ['17:00', 'ans:1'],
    ]);
    const long = presentAssistantResult(
      {
        kind: 'question',
        question: 'Which task do you mean?',
        options: ['Send standup notes to Alisher', 'Dentist'],
      },
      tz,
      now,
    );
    expect(long.keyboard?.inline_keyboard.map((row) => row.length)).toEqual([
      1, 1,
    ]);
    expect(
      presentAssistantResult({ kind: 'chat', reply: '1 < 2' }, tz, now).html,
    ).toBe('1 &lt; 2');
  });
});
