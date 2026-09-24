import {
  briefKeyboard,
  presentBrief,
  presentReview,
  presentWrap,
} from './rhythm.presenter';
import type { MorningBrief, ReviewState } from '@domain/rhythm';
import { makeTask } from '@test/factories';

const tz = 'Asia/Tashkent';
const buttons = (reply: {
  keyboard?: { inline_keyboard: { text: string }[][] };
}) =>
  (reply.keyboard?.inline_keyboard ?? []).map((row) => row.map((b) => b.text));

describe('presentBrief', () => {
  const brief: MorningBrief = {
    kind: 'brief',
    chatId: 42,
    timezone: tz,
    now: new Date('2026-09-17T03:00:00Z'),
    firstName: 'Izzat <3',
    today: [
      makeTask({
        description: 'Standup',
        scheduledAt: new Date('2026-09-17T04:30:00Z'),
        recurrence: { type: 'weekdays' },
      }),
      makeTask({
        description: 'Dentist',
        scheduledAt: new Date('2026-09-17T09:00:00Z'),
        priority: 'high',
      }),
    ],
    overdue: [
      makeTask({
        description: 'Pay bill',
        scheduledAt: new Date('2026-09-15T06:00:00Z'),
      }),
    ],
    inbox: [makeTask({ description: 'Buy headphones', scheduledAt: null })],
    inboxCount: 4,
    undelivered: [],
    scheduled: true,
  };

  it('greets, numbers today then overdue continuously, and summarises the inbox', () => {
    const reply = presentBrief(brief);
    expect(reply.html).toContain('Good morning, Izzat &lt;3!');
    expect(reply.html).toContain('<i>Thursday, 17 September</i>');
    expect(reply.html).toContain(
      '<b>Today</b> · 2\n1. <b>09:30</b> Standup 🔁\n2. <b>14:00</b> Dentist ❗',
    );
    expect(reply.html).toContain(
      '🔴 <b>Overdue</b> · 1\n3. Pay bill · since Tue 11:00',
    );
    expect(reply.html).toContain(
      '📥 <b>Inbox</b> · 4 without a date: Buy headphones, …',
    );
    expect(buttons(reply)).toEqual([['⏭ Move overdue to today']]);
  });

  it('names reminders that could not be delivered, with their time', () => {
    const reply = presentBrief({
      ...brief,
      undelivered: [
        makeTask({
          description: 'Call the bank <now>',
          scheduledAt: new Date('2026-09-16T13:00:00Z'), // Wed 18:00 local
        }),
      ],
    });
    expect(reply.html).toContain(
      '⚠️ <b>Could not be delivered</b> · 1: Call the bank &lt;now&gt; (Wed 18:00)',
    );
  });

  it('an empty day says so, without the move button or the reply hint', () => {
    const reply = presentBrief({
      ...brief,
      today: [],
      overdue: [],
      inbox: [],
      inboxCount: 0,
      scheduled: false,
    });
    expect(reply.html).toContain('📋 <b>Your day</b>');
    expect(reply.html).toContain('Nothing scheduled for today.');
    expect(reply.html).not.toContain('Reply to this message');
    expect(reply.keyboard).toBeUndefined();
  });
});

describe('presentReview', () => {
  const now = new Date('2026-09-17T16:00:00Z');
  const review: ReviewState = {
    timezone: tz,
    doneToday: 3,
    items: [
      {
        taskId: 'a',
        title: 'Pay bill',
        dueAt: new Date('2026-09-15T06:00:00Z'),
        recurring: false,
        outcome: null,
        newDueAt: null,
      },
      {
        taskId: 'b',
        title: 'Gym',
        dueAt: new Date('2026-09-17T02:00:00Z'),
        recurring: true,
        outcome: null,
        newDueAt: null,
      },
    ],
  };

  it('open rows get Done / Tomorrow / No date (Skip for repeats) and an all-button', () => {
    const reply = presentReview(review, now);
    expect(reply.html).toContain('✅ Done today: <b>3</b>');
    expect(reply.html).toContain('1. <b>Pay bill</b> · Tue 11:00');
    expect(reply.html).toContain('2. <b>Gym</b> · 07:00');
    expect(buttons(reply)).toEqual([
      ['1 ✅', '1 ⏭ Tmrw 09:00', '1 📥 No date'],
      ['2 ✅', '2 ⏭ Tmrw 09:00', '2 ⏩ Skip'],
      ['⏭ All open → tomorrow 09:00'],
    ]);
  });

  it('resolved rows show what happened and lose their buttons; all sorted → no keyboard', () => {
    const partly = presentReview(
      {
        ...review,
        items: [
          {
            ...review.items[0]!,
            outcome: 'tomorrow',
            newDueAt: new Date('2026-09-18T04:00:00Z'),
          },
          review.items[1]!,
        ],
      },
      now,
    );
    expect(partly.html).toContain('1. ⏭ Pay bill → Fri 09:00');
    expect(buttons(partly)).toEqual([['2 ✅', '2 ⏭ Tmrw 09:00', '2 ⏩ Skip']]);

    const done = presentReview(
      {
        ...review,
        items: review.items.map((i) => ({ ...i, outcome: 'done' as const })),
      },
      now,
    );
    expect(done.html).toContain('1. ✅ <s>Pay bill</s>');
    expect(done.html).toContain('All sorted. Good night!');
    expect(done.keyboard).toBeUndefined();
  });

  it('nothing open at all', () => {
    expect(
      presentReview({ timezone: tz, doneToday: 0, items: [] }, now).html,
    ).toContain('Nothing left open');
  });
});

describe('presentWrap', () => {
  it('reads like a short summary and only mentions what applies', () => {
    const reply = presentWrap({
      kind: 'wrap',
      chatId: 42,
      timezone: tz,
      weekStart: new Date('2026-09-13T19:00:00Z'),
      weekEnd: new Date('2026-09-20T19:00:00Z'),
      done: 14,
      streakDays: 6,
      overdueNow: 2,
      mostSnoozed: [{ title: 'Call the dentist', count: 5 }],
      nextWeekCount: 9,
      busiestDay: { day: new Date('2026-09-22T05:00:00Z'), count: 4 },
    });
    expect(reply.html).toContain('📊 <b>Your week</b> · 14–20 Sep');
    expect(reply.html).toContain('✅ <b>14</b> things done');
    expect(reply.html).toContain('🔥 6-day streak');
    expect(reply.html).toContain('🔴 2 still overdue');
    expect(reply.html).toContain('“Call the dentist” (5×)');
    expect(reply.html).toContain(
      '📅 Next 7 days: 9 scheduled · busiest Tue 22 Sep (4)',
    );
  });
});

describe('briefKeyboard', () => {
  const buttons = (hasOverdue: boolean) =>
    (briefKeyboard(hasOverdue)?.inline_keyboard ?? []).flat();

  beforeEach(() => {
    process.env['MINI_APP_URL'] = 'https://remy.example.com/app';
  });
  afterEach(() => {
    delete process.env['MINI_APP_URL'];
  });

  it('opens Catch-up when something is overdue, the app otherwise', () => {
    expect(buttons(true)).toEqual([
      expect.objectContaining({ callback_data: 'brief:overdue' }),
      expect.objectContaining({
        text: '🧹 Catch up in the app',
        web_app: { url: 'https://remy.example.com/app?screen=catchup' },
      }),
    ]);
    expect(buttons(false)).toEqual([
      expect.objectContaining({
        text: '📋 Open Remy',
        web_app: { url: 'https://remy.example.com/app' },
      }),
    ]);
  });
});
