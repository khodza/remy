import { HandleMessageUsecase } from './usecase';
import type { HandleMessageInput } from './types';
import type {
  Interpretation,
  InterpreterGateway,
  InterpreterInput,
} from '@domain/assistant';
import { TaskStatus } from '@domain/task';
import { UndoRecorder } from '../undo-recorder';
import {
  makeTask,
  makeUser,
  mockConversationRepository,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';
import { ListCategoriesUsecase } from '../../category/list-categories';
import type { MarkCompleteUsecase } from '../../task/mark-complete';
import type { DeleteTaskUsecase } from '../../task/delete-task';
import type { SnoozeTaskUsecase } from '../../task/snooze-task';
import type { UpdateTaskUsecase } from '../../task/update-task';

describe('HandleMessageUsecase', () => {
  const now = new Date('2026-09-18T09:47:00Z'); // 14:47 Tashkent
  const healthId = 'a'.repeat(24);

  const dentist = makeTask({
    id: 'dentist',
    description: 'Dentist',
    scheduledAt: new Date('2026-09-19T05:00:00Z'),
  });
  const mom = makeTask({
    id: 'mom',
    description: 'Call mom',
    scheduledAt: new Date('2026-09-18T14:00:00Z'),
    recurrence: { type: 'weekly' },
  });
  const plov = makeTask({
    id: 'plov',
    description: 'Learn plov',
    scheduledAt: null,
  });

  let tasks: ReturnType<typeof mockTaskRepository>;
  let conversations: ReturnType<typeof mockConversationRepository>;
  let interpreter: jest.Mocked<InterpreterGateway>;
  let markComplete: { execute: jest.Mock };
  let deleteTask: { execute: jest.Mock };
  let snoozeTask: { execute: jest.Mock };
  let updateTask: { execute: jest.Mock };
  let usecase: HandleMessageUsecase;

  const input = (
    over: Partial<HandleMessageInput> = {},
  ): HandleMessageInput => ({
    userId: 'user-1',
    chatId: 42,
    text: 'hello',
    timezone: 'Asia/Tashkent',
    source: { type: 'text', messageId: 500 },
    ...over,
  });
  const interpretAs = (i: Interpretation) =>
    interpreter.interpret.mockResolvedValue(i);
  const seen = (): InterpreterInput => interpreter.interpret.mock.calls[0]![0];

  beforeEach(() => {
    jest.useFakeTimers({ now });
    tasks = mockTaskRepository();
    // Mongo returns todos first (null fire time).
    // Candidates come from two queries (dated, todos); the mock returns the
    // same list for both and the use case de-duplicates by id.
    tasks.find.mockResolvedValue([plov, mom, dentist]);
    tasks.create.mockImplementation(async (p) =>
      makeTask({
        id: `new-${p.description}`,
        description: p.description,
        scheduledAt: p.scheduledAt,
      }),
    );
    conversations = mockConversationRepository();
    interpreter = { interpret: jest.fn() };
    markComplete = {
      execute: jest.fn(async ({ taskId }) => ({
        ...makeTask({ id: taskId, status: TaskStatus.Completed }),
        alreadyDone: false,
      })),
    };
    deleteTask = { execute: jest.fn(async () => ({ success: true })) };
    snoozeTask = {
      execute: jest.fn(async ({ taskId, until }) =>
        makeTask({ id: taskId, scheduledAt: until }),
      ),
    };
    updateTask = {
      execute: jest.fn(async ({ taskId, ...rest }) =>
        makeTask({ id: taskId, ...rest }),
      ),
    };
    const users = mockUserRepository(
      makeUser({
        categories: [
          {
            id: healthId,
            name: 'Health',
            emoji: '🩺',
            color: '#F04438',
            keywords: [],
          },
        ],
      }),
    );
    usecase = new HandleMessageUsecase(
      interpreter,
      tasks,
      conversations,
      new ListCategoriesUsecase(users),
      markComplete as unknown as MarkCompleteUsecase,
      deleteTask as unknown as DeleteTaskUsecase,
      snoozeTask as unknown as SnoozeTaskUsecase,
      updateTask as unknown as UpdateTaskUsecase,
      new UndoRecorder(conversations),
    );
  });
  afterEach(() => jest.useRealTimers());

  describe('what the interpreter is told', () => {
    it('open tasks by due time with todos last, categories, and no stale context', async () => {
      interpretAs({ intent: 'chat', reply: 'hi' });
      await usecase.execute(input());
      expect(seen().candidates.map((c) => c.id)).toEqual([
        'mom',
        'dentist',
        'plov',
      ]);
      expect(seen().candidates[0]).toEqual({
        id: 'mom',
        title: 'Call mom',
        dueAt: mom.scheduledAt,
        recurring: true,
      });
      expect(seen()).toMatchObject({
        categories: ['Health'],
        timezone: 'Asia/Tashkent',
        now,
        replyToTaskIds: [],
        pendingQuestion: null,
        quoted: null,
      });
    });

    it('dated tasks and todos are fetched separately, so a long Inbox cannot hide dated tasks', async () => {
      tasks.find.mockImplementation(async (filter) =>
        filter.kind === 'todo'
          ? [plov]
          : filter.kind === 'reminder'
            ? [mom, dentist]
            : [],
      );
      interpretAs({ intent: 'chat', reply: 'hi' });
      await usecase.execute(input());
      expect(tasks.find).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'reminder', sort: 'dueAt', limit: 45 }),
      );
      expect(tasks.find).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'todo',
          sort: 'createdAtDesc',
          limit: 15,
        }),
      );
      expect(seen().candidates.map((c) => c.id)).toEqual([
        'mom',
        'dentist',
        'plov',
      ]);
    });

    it('a reply to a numbered bot list puts those tasks first, in that order', async () => {
      await conversations.linkMessage({
        chatId: 42,
        messageId: 900,
        taskIds: ['dentist', 'plov'],
        kind: 'agenda',
      });
      interpretAs({ intent: 'chat', reply: 'ok' });
      await usecase.execute(input({ replyToMessageId: 900 }));
      expect(seen().replyToTaskIds).toEqual(['dentist', 'plov']);
      expect(seen().candidates.map((c) => c.id)).toEqual([
        'dentist',
        'plov',
        'mom',
      ]);
    });

    it('passes a fresh pending question, and forgets an old one', async () => {
      interpretAs({ intent: 'chat', reply: 'ok' });
      await conversations.setPendingQuestion(42, {
        originalText: 'call mom at 5',
        question: 'Morning or evening?',
        options: [],
        askedAt: new Date('2026-09-18T09:45:00Z'),
      });
      await usecase.execute(input({ text: 'evening' }));
      expect(seen().pendingQuestion).toEqual({
        originalText: 'call mom at 5',
        question: 'Morning or evening?',
        answered: [],
      });

      interpreter.interpret.mockClear();
      await conversations.setPendingQuestion(42, {
        originalText: 'x',
        question: 'y?',
        options: [],
        askedAt: new Date('2026-09-18T09:00:00Z'),
      });
      await usecase.execute(input());
      expect(seen().pendingQuestion).toBeNull();
    });
  });

  describe('create', () => {
    it('saves every draft with source, category, anchored recurrence, and one undo for all', async () => {
      const dueAt = new Date('2026-09-21T02:00:00Z');
      interpretAs({
        intent: 'create',
        tasks: [
          {
            title: 'Buy milk',
            dueAt: null,
            recurrence: null,
            priority: 'normal',
            categoryName: null,
            leadMinutes: 15,
            notes: null,
          },
          {
            title: 'Gym',
            dueAt,
            recurrence: { type: 'weekly', byWeekday: [1, 4] },
            priority: 'high',
            categoryName: 'Health',
            leadMinutes: 30,
            notes: 'bring towel',
          },
        ],
      });

      const result = await usecase.execute(
        input({ text: 'buy milk, gym every mon and thu 7am' }),
      );

      expect(tasks.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          description: 'Buy milk',
          scheduledAt: null,
          recurrence: null,
          leadMinutes: null,
          categoryId: null,
        }),
      );
      expect(tasks.create).toHaveBeenNthCalledWith(2, {
        userId: 'user-1',
        telegramChatId: 42,
        description: 'Gym',
        notes: 'bring towel',
        scheduledAt: dueAt,
        timezone: 'Asia/Tashkent',
        allDay: false,
        recurrence: { type: 'weekly', byWeekday: [1, 4], anchorAt: dueAt },
        priority: 'high',
        categoryId: healthId,
        leadMinutes: 30,
        source: {
          type: 'text',
          originalText: 'buy milk, gym every mon and thu 7am',
          messageId: 500,
          forwardedFrom: null,
        },
      });
      if (result.kind !== 'created') throw new Error('expected created');
      expect(conversations.undos.get(result.undoId)).toMatchObject({
        createdTaskIds: ['new-Buy milk', 'new-Gym'],
        snapshots: [],
        label: 'created 2 tasks',
      });
      expect((await conversations.getState(42)).lastTaskIds).toEqual([
        'new-Buy milk',
        'new-Gym',
      ]);
    });

    it('a forwarded message waiting for "when" becomes the quote, the notes and the source', async () => {
      await usecase.captureForward({
        chatId: 42,
        text: 'Your slot on Thu 10:00 is confirmed',
        forwardedFrom: 'Clinic',
        messageId: 499,
      });
      interpretAs({
        intent: 'create',
        tasks: [
          {
            title: 'Dentist appointment',
            dueAt: new Date('2026-09-19T04:00:00Z'),
            recurrence: null,
            priority: 'normal',
            categoryName: null,
            leadMinutes: null,
            notes: null,
          },
        ],
      });

      await usecase.execute(input({ text: 'friday morning' }));

      expect(seen().quoted).toEqual({
        text: 'Your slot on Thu 10:00 is confirmed',
        from: 'Clinic',
      });
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: 'Your slot on Thu 10:00 is confirmed',
          source: {
            type: 'forward',
            originalText: 'friday morning',
            messageId: 500,
            forwardedFrom: 'Clinic',
          },
        }),
      );
      expect((await conversations.getState(42)).pendingForward).toBeNull();
    });
  });

  it('complete: snapshots before acting so Undo can restore', async () => {
    interpretAs({ intent: 'complete', targetIds: ['dentist'] });
    const result = await usecase.execute(
      input({ text: 'done with the dentist' }),
    );
    if (result.kind !== 'completed') throw new Error('expected completed');
    expect(markComplete.execute).toHaveBeenCalledWith({ taskId: 'dentist' });
    expect(conversations.undos.get(result.undoId)?.snapshots[0]).toMatchObject({
      taskId: 'dentist',
      status: TaskStatus.Pending,
      scheduledAt: dentist.scheduledAt,
    });
    expect(conversations.saveUndo.mock.invocationCallOrder[0]).toBeLessThan(
      markComplete.execute.mock.invocationCallOrder[0]!,
    );
  });

  it('delete and edit act on the picked task', async () => {
    interpretAs({ intent: 'delete', targetIds: ['plov'] });
    expect((await usecase.execute(input())).kind).toBe('deleted');
    expect(deleteTask.execute).toHaveBeenCalledWith({ taskId: 'plov' });

    interpretAs({
      intent: 'edit',
      targetId: 'mom',
      title: 'Call dad',
      notes: null,
    });
    expect((await usecase.execute(input())).kind).toBe('edited');
    expect(updateTask.execute).toHaveBeenCalledWith({
      taskId: 'mom',
      description: 'Call dad',
    });
  });

  describe('reschedule', () => {
    it('an absolute time moves a reminder via snooze and gives a todo its first time', async () => {
      const at = new Date('2026-09-19T06:00:00Z');
      interpretAs({
        intent: 'reschedule',
        targetIds: ['dentist', 'plov'],
        dueAt: at,
        shiftMinutes: null,
      });
      const result = await usecase.execute(input());
      expect(snoozeTask.execute).toHaveBeenCalledWith({
        taskId: 'dentist',
        until: at,
      });
      expect(updateTask.execute).toHaveBeenCalledWith({
        taskId: 'plov',
        scheduledAt: at,
      });
      expect(result).toMatchObject({ kind: 'rescheduled', skipped: [] });
    });

    it('a shift keeps each time of day; todos and results in the past are skipped, not guessed', async () => {
      interpretAs({
        intent: 'reschedule',
        targetIds: ['mom', 'dentist', 'plov'],
        dueAt: null,
        shiftMinutes: 1440,
      });
      const result = await usecase.execute(input());
      if (result.kind !== 'rescheduled')
        throw new Error('expected rescheduled');
      expect(snoozeTask.execute).toHaveBeenCalledWith({
        taskId: 'mom',
        until: new Date('2026-09-19T14:00:00Z'),
      });
      expect(snoozeTask.execute).toHaveBeenCalledWith({
        taskId: 'dentist',
        until: new Date('2026-09-20T05:00:00Z'),
      });
      expect(result.skipped.map((t) => t.id)).toEqual(['plov']);
    });

    it('nothing movable → nothing changes and no undo is offered', async () => {
      interpretAs({
        intent: 'reschedule',
        targetIds: ['dentist'],
        dueAt: new Date('2026-09-18T09:00:00Z'),
        shiftMinutes: null,
      });
      const result = await usecase.execute(input());
      expect(result).toMatchObject({
        kind: 'rescheduled',
        tasks: [],
        undoId: null,
      });
      expect(snoozeTask.execute).not.toHaveBeenCalled();
      expect(conversations.saveUndo).not.toHaveBeenCalled();
    });
  });

  it('query: "tomorrow" asks the repository for the user\'s next local day', async () => {
    interpretAs({ intent: 'query', range: 'tomorrow', search: null });
    tasks.find
      .mockResolvedValueOnce([mom, dentist]) // dated candidates
      .mockResolvedValueOnce([plov]) // todo candidates
      .mockResolvedValueOnce([dentist]);
    const result = await usecase.execute(
      input({ text: "what's on tomorrow?" }),
    );
    expect(tasks.find).toHaveBeenLastCalledWith({
      userId: 'user-1',
      statuses: [TaskStatus.Pending],
      sort: 'dueAt',
      kind: 'reminder',
      dueAfter: new Date('2026-09-18T18:59:59.999Z'),
      dueAtOrBefore: new Date('2026-09-19T18:59:59.999Z'),
    });
    expect(result).toMatchObject({
      kind: 'agenda',
      range: 'tomorrow',
      tasks: [dentist],
    });
  });

  it('query with a search filters titles and notes', async () => {
    interpretAs({ intent: 'query', range: 'all', search: 'PLOV' });
    const result = await usecase.execute(input());
    if (result.kind !== 'agenda') throw new Error('expected agenda');
    expect(result.tasks.map((t) => t.id)).toEqual(['plov']);
  });

  it('unclear: remembers the question; the next non-question clears it', async () => {
    interpretAs({
      intent: 'unclear',
      question: 'Morning or evening?',
      options: ['05:00', '17:00'],
    });
    await usecase.execute(input({ text: 'call mom at 5' }));
    expect((await conversations.getState(42)).pendingQuestion).toMatchObject({
      originalText: 'call mom at 5',
      options: ['05:00', '17:00'],
    });

    interpretAs({ intent: 'chat', reply: 'ok' });
    await usecase.execute(input({ text: '17:00' }));
    expect((await conversations.getState(42)).pendingQuestion).toBeNull();
  });

  it('a second question keeps the first answer, so nothing said is lost', async () => {
    interpretAs({ intent: 'unclear', question: 'AM or PM?', options: [] });
    await usecase.execute(input({ text: 'brother at 5 today' }));
    interpretAs({ intent: 'unclear', question: 'Which day?', options: [] });
    await usecase.execute(input({ text: '17:00' }));

    interpretAs({ intent: 'chat', reply: 'ok' });
    await usecase.execute(input({ text: 'tomorrow' }));
    const last = interpreter.interpret.mock.calls.at(-1)![0];
    expect(last.pendingQuestion).toEqual({
      originalText: 'brother at 5 today',
      question: 'Which day?',
      answered: [{ question: 'AM or PM?', answer: '17:00' }],
    });
  });

  it('stops asking after three rounds instead of going in circles', async () => {
    interpretAs({ intent: 'unclear', question: 'What?', options: ['a'] });
    const results = [];
    for (const text of ['at 5', 'a', 'a', 'a'])
      results.push(await usecase.execute(input({ text })));

    expect(results.map((r) => r.kind)).toEqual([
      'question',
      'question',
      'question',
      'chat',
    ]);
    expect((await conversations.getState(42)).pendingQuestion).toBeNull();
  });

  it('a tapped answer still belongs to its question after the typing window', async () => {
    await conversations.setPendingQuestion(42, {
      originalText: 'call mom at 5',
      question: 'Morning or evening?',
      options: ['05:00', '17:00'],
      askedAt: new Date('2020-01-01T00:00:00Z'),
    });
    interpretAs({ intent: 'chat', reply: 'ok' });
    await usecase.execute(
      input({ text: '17:00', answersPendingQuestion: true }),
    );
    expect(seen().pendingQuestion).toMatchObject({
      originalText: 'call mom at 5',
    });
  });

  it('a target the model invented (not in the list) becomes a question, not an action', async () => {
    interpretAs({ intent: 'complete', targetIds: ['ghost'] });
    expect((await usecase.execute(input())).kind).toBe('question');
    expect(markComplete.execute).not.toHaveBeenCalled();
  });
});
