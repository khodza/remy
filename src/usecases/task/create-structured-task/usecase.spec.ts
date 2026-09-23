import { CreateStructuredTaskUsecase } from './usecase';
import { InvalidInputError } from '@common/errors';
import {
  makeTask,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';

describe('CreateStructuredTaskUsecase', () => {
  const base = {
    userId: 'user-1',
    telegramChatId: 42,
    timezone: 'Asia/Tashkent',
  };
  const at = new Date('2026-09-18T12:00:00Z');
  let tasks: ReturnType<typeof mockTaskRepository>;
  let usecase: CreateStructuredTaskUsecase;

  beforeEach(() => {
    tasks = mockTaskRepository();
    tasks.create.mockImplementation(async () => makeTask());
    usecase = new CreateStructuredTaskUsecase(tasks, mockUserRepository());
  });

  it('saves exactly the reviewed fields, anchors the recurrence, marks the source', async () => {
    await usecase.execute({
      ...base,
      description: ' Call mom ',
      scheduledAt: at,
      recurrence: { type: 'weekly' },
      priority: 'high',
      leadMinutes: 30,
      originalText: 'call mom tomorrow at 5 every week',
    });
    expect(tasks.create).toHaveBeenCalledWith({
      ...base,
      description: 'Call mom',
      notes: null,
      scheduledAt: at,
      recurrence: { type: 'weekly', anchorAt: at },
      priority: 'high',
      categoryId: null,
      leadMinutes: 30,
      allDay: false,
      list: null,
      source: {
        type: 'miniapp',
        originalText: 'call mom tomorrow at 5 every week',
        messageId: null,
        forwardedFrom: null,
      },
    });
  });

  it('creates a todo when no time is given', async () => {
    await usecase.execute({ ...base, description: 'Learn plov' });
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: null,
        recurrence: null,
        leadMinutes: null,
        priority: 'normal',
      }),
    );
  });

  it('an all-day task moves to 09:00 on its local date; lists are normalised', async () => {
    await usecase.execute({
      ...base,
      description: 'Mom birthday',
      // 23:00 on 17 Sep in Tashkent (UTC+5).
      scheduledAt: new Date('2026-09-17T18:00:00Z'),
      allDay: true,
      list: '  My Family List ',
      sourceType: 'voice',
    });
    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: new Date('2026-09-17T04:00:00Z'),
        allDay: true,
        list: 'family',
        source: expect.objectContaining({ type: 'voice' }),
      }),
    );
  });

  it.each([
    ['an all-day todo', { description: 'x', allDay: true }],
    [
      'a recurring todo',
      { description: 'x', recurrence: { type: 'daily' as const } },
    ],
    ['lead time on a todo', { description: 'x', leadMinutes: 10 }],
    ['a blank title', { description: '  ' }],
    ['an unknown category', { description: 'x', categoryId: 'f'.repeat(24) }],
  ])('rejects %s', async (_label, input) => {
    await expect(usecase.execute({ ...base, ...input })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    expect(tasks.create).not.toHaveBeenCalled();
  });
});
