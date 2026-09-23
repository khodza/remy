import type {
  Interpretation,
  InterpreterGateway,
  InterpreterInput,
  TaskDraft,
} from '@domain/assistant';
import { NotATaskError } from '@domain/assistant';
import { UserNotFoundError } from '@domain/user';
import { ListCategoriesUsecase } from '@usecases/category';
import { makeUser, mockUserRepository } from '@test/factories';
import { ParseTaskUsecase } from './usecase';

const NOW = new Date('2026-09-19T10:00:00Z');

const draft = (title: string, extra: Partial<TaskDraft> = {}): TaskDraft => ({
  title,
  dueAt: null,
  recurrence: null,
  priority: 'normal',
  categoryName: null,
  leadMinutes: null,
  notes: null,
  ...extra,
});

function setup(
  answer: (input: InterpreterInput) => Interpretation | Error,
  timezone: string | null = 'Asia/Tashkent',
) {
  const users = mockUserRepository(makeUser({ timezone }));
  const interpreter: jest.Mocked<InterpreterGateway> = {
    interpret: jest.fn(async (input: InterpreterInput) => {
      const result = answer(input);
      if (result instanceof Error) throw result;
      return result;
    }),
  };
  const usecase = new ParseTaskUsecase(
    users,
    interpreter,
    new ListCategoriesUsecase(users),
  );
  return { usecase, interpreter };
}

describe('ParseTaskUsecase', () => {
  afterEach(() => {
    delete process.env['OWNER_TIMEZONE'];
  });

  it('turns a create into drafts: category by name, list normalised, todo drops repeat and lead', async () => {
    const due = new Date('2026-09-20T05:00:00Z');
    const { usecase, interpreter } = setup(() => ({
      intent: 'create',
      tasks: [
        draft('Dentist', {
          dueAt: due,
          categoryName: 'health',
          leadMinutes: 30,
          priority: 'high',
          allDay: false,
        }),
        draft('Milk', {
          recurrence: { type: 'daily' },
          leadMinutes: 10,
          allDay: true,
          list: 'Shopping list',
        }),
      ],
    }));
    const drafts = await usecase.execute({
      userId: 'user-1',
      text: 'dentist tomorrow 10, and milk',
      now: NOW,
    });
    expect(interpreter.interpret).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'dentist tomorrow 10, and milk', // no "Add this as a task"
        timezone: 'Asia/Tashkent',
        now: NOW,
        candidates: [],
      }),
    );
    expect(drafts[0]).toMatchObject({
      description: 'Dentist',
      scheduledAt: due,
      priority: 'high',
      leadMinutes: 30,
      allDay: false,
      list: null,
      categoryId: expect.any(String),
    });
    expect(drafts[1]).toEqual({
      description: 'Milk',
      notes: null,
      scheduledAt: null,
      allDay: false,
      recurrence: null,
      priority: 'normal',
      categoryId: null,
      leadMinutes: null,
      list: 'shopping',
    });
  });

  it('falls back to OWNER_TIMEZONE when the profile has no zone (gap 4)', async () => {
    process.env['OWNER_TIMEZONE'] = 'Europe/Berlin';
    const { usecase, interpreter } = setup(
      () => ({ intent: 'create', tasks: [draft('x')] }),
      null,
    );
    await usecase.execute({ userId: 'user-1', text: 'x' });
    expect(interpreter.interpret.mock.calls[0]![0].timezone).toBe(
      'Europe/Berlin',
    );
  });

  it.each([
    [
      'garbage or chat (B20)',
      { intent: 'chat', reply: 'Thanks for watching!' },
      /does not look like something to remember/,
    ],
    [
      'a time that already passed (B6)',
      {
        intent: 'unclear',
        question:
          '"Call mom": that time has already passed. When should I remind you?',
        options: [],
      },
      /already passed/,
    ],
    [
      'a change to an existing task',
      { intent: 'complete', targetIds: ['t1'] },
      /existing task/,
    ],
    [
      'a question',
      { intent: 'query', range: 'today', search: null },
      /does not look like/,
    ],
  ] as const)(
    'refuses %s with a NotATaskError',
    async (_label, answer, message) => {
      const { usecase } = setup(() => answer as Interpretation);
      const error = await usecase
        .execute({ userId: 'user-1', text: 'whatever' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotATaskError);
      expect((error as Error).message).toMatch(message);
    },
  );

  it('lets interpreter failures through (502 upstream) and 404s an unknown user', async () => {
    const { usecase } = setup(() => new Error('openai down'));
    await expect(
      usecase.execute({ userId: 'user-1', text: 'x' }),
    ).rejects.toThrow('openai down');
    await expect(
      usecase.execute({ userId: 'nobody', text: 'x' }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('reads list lines on their own and marks unreadable ones null', async () => {
    const { usecase, interpreter } = setup((input) =>
      input.text.endsWith('milk')
        ? { intent: 'create', tasks: [draft('Milk')] }
        : input.text.endsWith('boom')
          ? new Error('down')
          : { intent: 'chat', reply: 'hi' },
    );
    const result = await usecase.executeLines({
      userId: 'user-1',
      lines: ['milk', 'boom', 'hello'],
      now: NOW,
    });
    expect(result.map((r) => r?.map((d) => d.description) ?? null)).toEqual([
      ['Milk'],
      null,
      null,
    ]);
    expect(interpreter.interpret.mock.calls.map((c) => c[0].text)).toEqual([
      'Add this as a task: milk',
      'Add this as a task: boom',
      'Add this as a task: hello',
    ]);
  });
});
