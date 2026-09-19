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
        { kind: 'agenda', range: 'today', search: null, tasks: [] },
        tz,
        now,
      ).html,
    ).toContain('Nothing here');
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
    expect(
      presentAssistantResult({ kind: 'chat', reply: '1 < 2' }, tz, now).html,
    ).toBe('1 &lt; 2');
  });
});
