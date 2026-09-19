import {
  interpretAssistantOutput,
  type AssistantModelOutput,
} from './interpret-output';
import { buildAssistantPrompt } from './prompt';
import type { CandidateTask, InterpreterInput } from '@domain/assistant';

const candidates: CandidateTask[] = [
  {
    id: 'id-dentist',
    title: 'Dentist',
    dueAt: new Date('2026-09-19T05:00:00Z'),
    recurring: false,
  },
  {
    id: 'id-mom',
    title: 'Call mom',
    dueAt: new Date('2026-09-18T14:00:00Z'),
    recurring: true,
  },
  { id: 'id-plov', title: 'Learn plov', dueAt: null, recurring: false },
];
// Fri 18 Sep 2026, 14:47 in Tashkent
const ctx = {
  text: 'the dentist, call mom and the plov thing',
  contextTaskIds: [] as string[],
  timezone: 'Asia/Tashkent',
  now: new Date('2026-09-18T09:47:00Z'),
  candidates,
  categories: ['Work', 'Health', 'Personal'],
};

/** A model reply with every field present, as strict mode guarantees. */
const reply = (over: Partial<AssistantModelOutput>): AssistantModelOutput => ({
  intent: 'chat',
  tasks: [],
  query_range: null,
  query_search: null,
  targets: [],
  due_local: null,
  in_minutes: null,
  shift_minutes: null,
  new_title: null,
  new_notes: null,
  reply: null,
  question: null,
  options: [],
  ...over,
});
const draft = (over: Partial<AssistantModelOutput['tasks'][number]>) => ({
  title: 'x',
  due_local: null,
  in_minutes: null,
  recurrence: null,
  priority: 'normal' as const,
  category: null,
  lead_minutes: null,
  notes: null,
  ...over,
});

describe('interpretAssistantOutput', () => {
  it('create: several tasks, wall-clock → instant in the user zone, todo without a time', () => {
    const result = interpretAssistantOutput(
      reply({
        intent: 'create',
        tasks: [
          draft({ title: 'Buy milk' }),
          draft({
            title: ' Call mom ',
            due_local: '2026-09-18T17:00:00',
            category: 'personal',
          }),
          draft({
            title: 'Dentist',
            due_local: '2026-09-19T10:00:00',
            category: 'Dental',
            lead_minutes: 30,
            priority: 'high',
          }),
        ],
      }),
      ctx,
    );
    expect(result).toEqual({
      intent: 'create',
      tasks: [
        {
          title: 'Buy milk',
          dueAt: null,
          recurrence: null,
          priority: 'normal',
          categoryName: null,
          leadMinutes: null,
          notes: null,
        },
        {
          title: 'Call mom',
          dueAt: new Date('2026-09-18T12:00:00Z'),
          recurrence: null,
          priority: 'normal',
          categoryName: 'Personal',
          leadMinutes: null,
          notes: null,
        },
        {
          title: 'Dentist',
          dueAt: new Date('2026-09-19T05:00:00Z'),
          recurrence: null,
          priority: 'high',
          categoryName: null,
          leadMinutes: 30,
          notes: null,
        },
      ],
    });
  });

  it('create: maps the recurrence grammar and drops recurrence/lead on a todo', () => {
    const rec = {
      type: 'weekly' as const,
      interval_days: null,
      interval: 2,
      by_weekday: [1, 4, 9],
      last_day_of_month: null,
      until_local: '2026-12-31T23:59:59',
    };
    const result = interpretAssistantOutput(
      reply({
        intent: 'create',
        tasks: [
          draft({
            title: 'Gym',
            due_local: '2026-09-21T07:00:00',
            recurrence: rec,
          }),
          draft({ title: 'Someday', recurrence: rec, lead_minutes: 10 }),
        ],
      }),
      ctx,
    );
    if (result.intent !== 'create') throw new Error('expected create');
    expect(result.tasks[0]?.recurrence).toEqual({
      type: 'weekly',
      interval: 2,
      byWeekday: [1, 4],
      until: new Date('2026-12-31T18:59:59Z'),
    });
    expect(result.tasks[1]).toMatchObject({
      dueAt: null,
      recurrence: null,
      leadMinutes: null,
    });
  });

  describe('safety nets for model slips', () => {
    const weekly = (by: number[] | null) => ({
      type: 'weekly' as const,
      interval_days: null,
      interval: null,
      by_weekday: by,
      last_day_of_month: null,
      until_local: null,
    });
    const firstDue = (raw: AssistantModelOutput) => {
      const r = interpretAssistantOutput(raw, ctx);
      if (r.intent !== 'create')
        throw new Error(`expected create, got ${r.intent}`);
      return r.tasks[0]!.dueAt;
    };

    it('"every Mon and Thu 7am" anchored on a past, unlisted day starts on the coming Monday', () => {
      // The model said "today 07:00" (a Friday, already past).
      expect(
        firstDue(
          reply({
            intent: 'create',
            tasks: [
              draft({
                title: 'gym',
                due_local: '2026-09-18T07:00:00',
                recurrence: weekly([1, 4]),
              }),
            ],
          }),
        ),
      ).toEqual(new Date('2026-09-21T02:00:00Z')); // Mon 07:00 Tashkent
    });

    it('a daily series whose first time already passed today starts tomorrow', () => {
      const daily = { ...weekly(null), type: 'daily' as const };
      expect(
        firstDue(
          reply({
            intent: 'create',
            tasks: [
              draft({
                title: 'vitamins',
                due_local: '2026-09-18T09:00:00',
                recurrence: daily,
              }),
            ],
          }),
        ),
      ).toEqual(new Date('2026-09-19T04:00:00Z'));
    });

    it('weekdays never start on a weekend', () => {
      const weekdays = { ...weekly(null), type: 'weekdays' as const };
      expect(
        firstDue(
          reply({
            intent: 'create',
            tasks: [
              draft({
                title: 'standup',
                due_local: '2026-09-19T09:30:00',
                recurrence: weekdays,
              }),
            ],
          }),
        ),
      ).toEqual(new Date('2026-09-21T04:30:00Z'));
    });

    it('a one-shot time that already passed becomes a question, never an instant reminder', () => {
      const r = interpretAssistantOutput(
        reply({
          intent: 'create',
          tasks: [
            draft({
              title: 'flight',
              due_local: '2026-09-18T12:00:00',
              lead_minutes: 180,
            }),
          ],
        }),
        ctx,
      );
      expect(r).toMatchObject({
        intent: 'unclear',
        question: expect.stringContaining('already passed'),
      });
    });

    it('accepts new values restated inside tasks[] for reschedule and edit', () => {
      expect(
        interpretAssistantOutput(
          reply({
            intent: 'reschedule',
            targets: [1],
            tasks: [
              draft({ title: 'Dentist', due_local: '2026-09-19T18:00:00' }),
            ],
          }),
          ctx,
        ),
      ).toEqual({
        intent: 'reschedule',
        targetIds: ['id-dentist'],
        dueAt: new Date('2026-09-19T13:00:00Z'),
        shiftMinutes: null,
      });

      expect(
        interpretAssistantOutput(
          reply({
            intent: 'edit',
            targets: [1],
            tasks: [draft({ title: 'dentist', notes: 'bring insurance card' })],
          }),
          ctx,
        ),
      ).toEqual({
        intent: 'edit',
        targetId: 'id-dentist',
        title: null,
        notes: 'bring insurance card',
      });

      expect(
        interpretAssistantOutput(
          reply({
            intent: 'edit',
            targets: [3],
            tasks: [draft({ title: 'learn to cook plov' })],
          }),
          ctx,
        ),
      ).toEqual({
        intent: 'edit',
        targetId: 'id-plov',
        title: 'Learn to cook plov',
        notes: null,
      });
    });

    it('durations are added by the server, not computed by the model', () => {
      expect(
        firstDue(
          reply({
            intent: 'create',
            tasks: [
              draft({
                title: 'tea',
                in_minutes: 20,
                due_local: '2026-09-18T23:00:00',
              }),
            ],
          }),
        ),
      ).toEqual(new Date('2026-09-18T10:07:00Z'));
      expect(
        interpretAssistantOutput(
          reply({ intent: 'reschedule', targets: [1], in_minutes: 120 }),
          ctx,
        ),
      ).toMatchObject({
        intent: 'reschedule',
        dueAt: new Date('2026-09-18T11:47:00Z'),
      });
    });

    describe('grounding: never act on a task the message does not point at', () => {
      const bare = { ...ctx, text: 'in 2 hours' };

      it('a bare time with no context asks which task, offering titles to tap', () => {
        expect(
          interpretAssistantOutput(
            reply({ intent: 'reschedule', targets: [2], in_minutes: 120 }),
            bare,
          ),
        ).toEqual({
          intent: 'unclear',
          question: 'Which task do you mean?',
          options: ['Dentist', 'Call mom', 'Learn plov'],
        });
        expect(
          interpretAssistantOutput(
            reply({ intent: 'complete', targets: [1] }),
            { ...ctx, text: 'done' },
          ).intent,
        ).toBe('unclear');
      });

      it('a reply / "it" context, a title word, or a bulk word grounds the action', () => {
        const act = reply({
          intent: 'reschedule',
          targets: [2],
          in_minutes: 120,
        });
        expect(
          interpretAssistantOutput(act, { ...bare, contextTaskIds: ['id-mom'] })
            .intent,
        ).toBe('reschedule');
        expect(
          interpretAssistantOutput(act, {
            ...ctx,
            text: 'snooze mom by 2 hours',
          }).intent,
        ).toBe('reschedule');
        expect(
          interpretAssistantOutput(
            reply({
              intent: 'reschedule',
              targets: [1, 2],
              shift_minutes: 1440,
            }),
            { ...ctx, text: 'push everything to tomorrow' },
          ).intent,
        ).toBe('reschedule');
        expect(
          interpretAssistantOutput(
            reply({ intent: 'complete', targets: [1] }),
            { ...ctx, text: "done with the dentist's thing" },
          ).intent,
        ).toBe('complete');
      });
    });

    it('capitalises titles', () => {
      const r = interpretAssistantOutput(
        reply({ intent: 'create', tasks: [draft({ title: 'buy milk' })] }),
        ctx,
      );
      expect(r).toMatchObject({ tasks: [{ title: 'Buy milk' }] });
    });
  });

  it('targets are list numbers → ids; unknown numbers are ignored', () => {
    expect(
      interpretAssistantOutput(
        reply({ intent: 'complete', targets: [1, 1, 7] }),
        ctx,
      ),
    ).toEqual({
      intent: 'complete',
      targetIds: ['id-dentist'],
    });
    expect(
      interpretAssistantOutput(
        reply({ intent: 'delete', targets: [2, 3] }),
        ctx,
      ),
    ).toEqual({
      intent: 'delete',
      targetIds: ['id-mom', 'id-plov'],
    });
  });

  it('reschedule: absolute time wins over a shift; a shift alone is kept', () => {
    expect(
      interpretAssistantOutput(
        reply({
          intent: 'reschedule',
          targets: [1],
          due_local: '2026-09-19T11:00:00',
          shift_minutes: 60,
        }),
        ctx,
      ),
    ).toEqual({
      intent: 'reschedule',
      targetIds: ['id-dentist'],
      dueAt: new Date('2026-09-19T06:00:00Z'),
      shiftMinutes: null,
    });
    expect(
      interpretAssistantOutput(
        reply({ intent: 'reschedule', targets: [1, 2], shift_minutes: 1440 }),
        ctx,
      ),
    ).toEqual({
      intent: 'reschedule',
      targetIds: ['id-dentist', 'id-mom'],
      dueAt: null,
      shiftMinutes: 1440,
    });
  });

  it('edit needs a target and something to change', () => {
    expect(
      interpretAssistantOutput(
        reply({ intent: 'edit', targets: [2], new_title: ' Call dad ' }),
        ctx,
      ),
    ).toEqual({
      intent: 'edit',
      targetId: 'id-mom',
      title: 'Call dad',
      notes: null,
    });
    expect(
      interpretAssistantOutput(reply({ intent: 'edit', targets: [2] }), ctx)
        .intent,
    ).toBe('unclear');
  });

  it('query defaults to today; chat and unclear pass through, options capped at 4', () => {
    expect(interpretAssistantOutput(reply({ intent: 'query' }), ctx)).toEqual({
      intent: 'query',
      range: 'today',
      search: null,
    });
    expect(
      interpretAssistantOutput(
        reply({ intent: 'query', query_range: 'all', query_search: ' visa ' }),
        ctx,
      ),
    ).toEqual({ intent: 'query', range: 'all', search: 'visa' });
    expect(
      interpretAssistantOutput(
        reply({ intent: 'chat', reply: 'Anytime!' }),
        ctx,
      ),
    ).toEqual({ intent: 'chat', reply: 'Anytime!' });
    expect(
      interpretAssistantOutput(
        reply({
          intent: 'unclear',
          question: 'Morning or evening?',
          options: ['05:00', '17:00', 'a', 'b', 'c'],
        }),
        ctx,
      ),
    ).toEqual({
      intent: 'unclear',
      question: 'Morning or evening?',
      options: ['05:00', '17:00', 'a', 'b'],
    });
  });

  it.each([
    ['complete without targets', reply({ intent: 'complete' })],
    [
      'delete with only unknown numbers',
      reply({ intent: 'delete', targets: [99] }),
    ],
    [
      'reschedule without a time',
      reply({ intent: 'reschedule', targets: [1] }),
    ],
    [
      'reschedule with a garbage time',
      reply({ intent: 'reschedule', targets: [1], due_local: 'soonish' }),
    ],
    [
      'create with only blank titles',
      reply({ intent: 'create', tasks: [draft({ title: '  ' })] }),
    ],
    [
      'create with a garbage time',
      reply({
        intent: 'create',
        tasks: [draft({ title: 'X', due_local: 'later' })],
      }),
    ],
    [
      'output that is not the schema at all',
      { hello: 'world' } as unknown as AssistantModelOutput,
    ],
  ])('never guesses: %s becomes a question', (_label, raw) => {
    expect(interpretAssistantOutput(raw, ctx).intent).toBe('unclear');
  });
});

describe('buildAssistantPrompt', () => {
  const input: InterpreterInput = {
    text: 'make it 11',
    timezone: 'Asia/Tashkent',
    now: new Date('2026-09-18T09:47:00Z'),
    candidates,
    categories: ['Work', 'Health'],
    replyToTaskIds: ['id-dentist'],
    lastTaskIds: ['id-mom'],
    pendingQuestion: {
      originalText: 'call mom at 5',
      question: 'Morning or evening?',
    },
    quoted: { text: 'Your slot on Thu is confirmed', from: 'Clinic' },
  };

  it('shows local now, the numbered tasks with local times and markers, and the context', () => {
    const prompt = buildAssistantPrompt(input);
    expect(prompt).toContain(
      '2026-09-18T14:47:00 (Friday); timezone Asia/Tashkent',
    );
    expect(prompt).toContain('1. Dentist — Sat 2026-09-19 10:00 [REPLIED-TO]');
    expect(prompt).toContain(
      '2. Call mom — Fri 2026-09-18 19:00 (repeats) [LAST]',
    );
    expect(prompt).toContain('3. Learn plov — no date');
    expect(prompt).toContain('Work, Health');
    expect(prompt).toContain('Morning or evening?');
    expect(prompt).toContain('from Clinic');
  });
});
