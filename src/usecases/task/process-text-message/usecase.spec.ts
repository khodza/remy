import { ProcessTextMessageUsecase } from './usecase';
import type { ParseTaskUsecase, ParsedTaskDraft } from '../parse-task';
import type { CreateStructuredTaskUsecase } from '../create-structured-task';
import { InvalidInputError } from '@common/errors';
import { NotATaskError } from '@domain/assistant';
import { makeTask } from '@test/factories';

describe('ProcessTextMessageUsecase', () => {
  const at = new Date('2026-04-16T15:00:00Z');
  const draft = (description: string, scheduledAt: Date | null) =>
    ({
      description,
      notes: null,
      scheduledAt,
      allDay: false,
      recurrence: null,
      priority: 'normal',
      categoryId: null,
      leadMinutes: null,
      list: null,
    }) satisfies ParsedTaskDraft;

  let parse: jest.Mocked<Pick<ParseTaskUsecase, 'execute'>>;
  let create: jest.Mocked<Pick<CreateStructuredTaskUsecase, 'execute'>>;
  let usecase: ProcessTextMessageUsecase;

  beforeEach(() => {
    parse = { execute: jest.fn() };
    create = {
      execute: jest.fn(async (input) =>
        makeTask({
          description: input.description,
          scheduledAt: input.scheduledAt ?? null,
        }),
      ),
    };
    usecase = new ProcessTextMessageUsecase(
      parse as unknown as ParseTaskUsecase,
      create as unknown as CreateStructuredTaskUsecase,
    );
  });

  it('saves every draft the text held, with the text as its source', async () => {
    parse.execute.mockResolvedValue([
      draft('Dentist', at),
      draft('Buy milk', null),
    ]);
    const { tasks } = await usecase.execute({
      userId: 'user-1',
      telegramChatId: 42,
      text: 'dentist at 8pm and buy milk',
      timezone: 'Asia/Tashkent',
    });
    expect(parse.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      text: 'dentist at 8pm and buy milk',
    });
    expect(tasks.map((t) => [t.description, t.kind])).toEqual([
      ['Dentist', 'reminder'],
      ['Buy milk', 'todo'],
    ]);
    expect(create.execute).toHaveBeenCalledWith({
      ...draft('Dentist', at),
      userId: 'user-1',
      telegramChatId: 42,
      timezone: 'Asia/Tashkent',
      originalText: 'dentist at 8pm and buy milk',
      sourceType: 'miniapp',
    });
  });

  it('saves nothing when the text is not a task, and rejects empty text', async () => {
    parse.execute.mockRejectedValue(new NotATaskError('nope'));
    await expect(
      usecase.execute({
        userId: 'user-1',
        telegramChatId: 42,
        text: 'lol',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(NotATaskError);
    await expect(
      usecase.execute({
        userId: 'user-1',
        telegramChatId: 42,
        text: '  ',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(create.execute).not.toHaveBeenCalled();
  });
});
