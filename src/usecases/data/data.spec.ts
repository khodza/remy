import { InvalidInputError } from '@common/errors';
import type {
  Interpretation,
  InterpreterGateway,
  InterpreterInput,
  TaskDraft,
} from '@domain/assistant';
import type { NotificationGateway } from '@domain/notification';
import { TaskStatus } from '@domain/task';
import { ListCategoriesUsecase } from '@usecases/category';
import { CreateStructuredTaskUsecase } from '@usecases/task/create-structured-task';
import {
  makeTask,
  makeUser,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';
import {
  CALENDAR_TOKEN_PATTERN,
  ExportDataUsecase,
  ImportTasksUsecase,
  ManageCalendarFeedUsecase,
  ParseListUsecase,
  RenderCalendarFeedUsecase,
  splitList,
} from '.';

const NOW = new Date('2026-09-19T10:00:00Z');

function mockNotifications(): jest.Mocked<NotificationGateway> {
  return {
    sendReminder: jest.fn(),
    sendDigest: jest.fn(),
    sendDocument: jest.fn().mockResolvedValue(undefined),
  };
}

describe('calendar feed', () => {
  it('turns on with a fresh 32-byte token, replaces it, and turns off', async () => {
    const users = mockUserRepository(makeUser());
    const manage = new ManageCalendarFeedUsecase(users);

    expect(await manage.execute({ userId: 'user-1', action: 'get' })).toEqual({
      enabled: false,
      token: null,
    });

    const first = await manage.execute({ userId: 'user-1', action: 'enable' });
    expect(first.enabled).toBe(true);
    expect(first.token).toMatch(CALENDAR_TOKEN_PATTERN);
    const second = await manage.execute({ userId: 'user-1', action: 'enable' });
    expect(second.token).not.toBe(first.token);
    expect(users.current().calendarToken).toBe(second.token);

    expect(
      await manage.execute({ userId: 'user-1', action: 'disable' }),
    ).toEqual({ enabled: false, token: null });
    expect(users.current().calendarToken).toBeNull();
  });

  it('renders pending reminders for a valid token and nothing for a bad, old or malformed one', async () => {
    const token = 'a'.repeat(43);
    const users = mockUserRepository(
      makeUser({
        calendarToken: token,
        categories: [
          {
            id: 'c1',
            name: 'Health',
            emoji: '🩺',
            color: '#F04438',
            keywords: [],
          },
        ],
      }),
    );
    const tasks = mockTaskRepository();
    tasks.find.mockResolvedValue([
      makeTask({
        id: 't1',
        description: 'Dentist',
        scheduledAt: new Date('2026-09-20T05:00:00Z'),
        categoryId: 'c1',
      }),
    ]);
    const render = new RenderCalendarFeedUsecase(users, tasks);

    const ics = await render.execute({ token, now: NOW });
    expect(ics).toContain('SUMMARY:Dentist');
    expect(ics).toContain('CATEGORIES:Health');
    expect(tasks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        statuses: [TaskStatus.Pending],
        kind: 'reminder',
      }),
    );

    expect(
      await render.execute({ token: 'b'.repeat(43), now: NOW }),
    ).toBeNull();
    expect(await render.execute({ token: 'short', now: NOW })).toBeNull();
    // Malformed tokens never reach the database.
    expect(users.findByCalendarToken).toHaveBeenCalledTimes(2);
  });
});

describe('export', () => {
  it('sends the file to the owner chat and reports the count', async () => {
    const users = mockUserRepository(
      makeUser({ telegramUserId: 777, timezone: 'Asia/Tashkent' }),
    );
    const tasks = mockTaskRepository();
    tasks.findByUserId.mockResolvedValue([
      makeTask({ id: 't1' }),
      makeTask({ id: 't2', status: TaskStatus.Completed, completedAt: NOW }),
    ]);
    const notifications = mockNotifications();
    const exporter = new ExportDataUsecase(users, tasks, notifications);

    const result = await exporter.execute({
      userId: 'user-1',
      format: 'csv',
      now: NOW,
    });
    expect(result).toEqual({ filename: 'remy-2026-09-19.csv', tasks: 2 });
    const sent = notifications.sendDocument.mock.calls[0]![0];
    expect(sent).toMatchObject({
      chatId: 777,
      filename: 'remy-2026-09-19.csv',
    });
    expect(sent.caption).toContain('2 tasks (1 open, 1 done)');
    expect(sent.content.split('\r\n')).toHaveLength(4); // header, 2 rows, trailing

    await exporter.execute({ userId: 'user-1', format: 'json', now: NOW });
    expect(
      JSON.parse(notifications.sendDocument.mock.calls[1]![0].content).tasks,
    ).toHaveLength(2);
  });
});

describe('list import', () => {
  it('splits a pasted list and strips bullets', () => {
    expect(
      splitList(
        '- milk\n* bread\n\n1. call mom at 5\n2) dentist\n[ ] rent\n  • tea  ',
      ),
    ).toEqual(['milk', 'bread', 'call mom at 5', 'dentist', 'rent', 'tea']);
    expect(
      splitList(Array.from({ length: 60 }, (_, i) => `task ${i}`).join('\n')),
    ).toHaveLength(50);
  });

  function parser(answer: (text: string) => Interpretation | Error) {
    const users = mockUserRepository(makeUser({ timezone: 'Asia/Tashkent' }));
    const interpreter: jest.Mocked<InterpreterGateway> = {
      interpret: jest.fn(async (input: InterpreterInput) => {
        const result = answer(input.text);
        if (result instanceof Error) throw result;
        return result;
      }),
    };
    return {
      interpreter,
      parse: new ParseListUsecase(
        users,
        interpreter,
        new ListCategoriesUsecase(users),
      ),
    };
  }
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

  it('reads each line on its own and keeps the list order', async () => {
    const due = new Date('2026-09-20T05:00:00Z');
    const { parse, interpreter } = parser((text) =>
      text.includes('dentist')
        ? {
            intent: 'create',
            tasks: [
              draft('Dentist', {
                dueAt: due,
                priority: 'high',
                categoryName: 'health',
                leadMinutes: 30,
              }),
            ],
          }
        : text.includes('milk')
          ? // No time: no repeat and no heads-up, whatever the model said.
            {
              intent: 'create',
              tasks: [
                draft('Buy milk', {
                  recurrence: { type: 'daily' },
                  leadMinutes: 15,
                }),
              ],
            }
          : {
              intent: 'create',
              tasks: [draft('Eggs'), draft('Call mom', { dueAt: due })],
            },
    );
    const drafts = await parse.execute({
      userId: 'user-1',
      text: '- dentist tomorrow 10 !\n- buy milk\n- eggs, and call mom',
      now: NOW,
    });

    expect(interpreter.interpret.mock.calls.map((c) => c[0].text)).toEqual([
      'Add this as a task: dentist tomorrow 10 !',
      'Add this as a task: buy milk',
      'Add this as a task: eggs, and call mom',
    ]);
    expect(interpreter.interpret.mock.calls[0]![0]).toMatchObject({
      timezone: 'Asia/Tashkent',
      candidates: [],
    });
    expect(drafts.map((d) => d.description)).toEqual([
      'Dentist',
      'Buy milk',
      'Eggs',
      'Call mom',
    ]);
    expect(drafts[0]).toMatchObject({
      scheduledAt: due,
      priority: 'high',
      leadMinutes: 30,
    });
    expect(drafts[0]!.categoryId).toEqual(expect.any(String));
    expect(drafts[1]).toMatchObject({
      scheduledAt: null,
      recurrence: null,
      leadMinutes: null,
    });
  });

  it('keeps a line as a todo when the assistant fails or answers something else', async () => {
    const { parse } = parser((text) =>
      text.endsWith('milk')
        ? new Error('openai down')
        : text.endsWith('hi there')
          ? { intent: 'chat', reply: 'hi' }
          : { intent: 'create', tasks: [draft('Bread')] },
    );
    const drafts = await parse.execute({
      userId: 'user-1',
      text: 'milk\nhi there\nbread',
      now: NOW,
    });
    expect(drafts.map((d) => [d.description, d.scheduledAt])).toEqual([
      ['milk', null],
      ['hi there', null],
      ['Bread', null],
    ]);
  });

  it('checks every row before creating any', async () => {
    const users = mockUserRepository(
      makeUser({
        categories: [
          {
            id: 'c1',
            name: 'Work',
            emoji: '💼',
            color: '#5B5BD6',
            keywords: [],
          },
        ],
      }),
    );
    const tasks = mockTaskRepository();
    tasks.create.mockImplementation(async (params) =>
      makeTask({
        description: params.description,
        scheduledAt: params.scheduledAt,
      }),
    );
    const importer = new ImportTasksUsecase(
      users,
      new CreateStructuredTaskUsecase(tasks, users),
    );

    await expect(
      importer.execute({
        userId: 'user-1',
        tasks: [
          { description: 'ok' },
          { description: 'bad', recurrence: { type: 'daily' } },
        ],
      }),
    ).rejects.toThrow(
      new InvalidInputError('Task 2: a repeating task needs a time'),
    );
    await expect(
      importer.execute({
        userId: 'user-1',
        tasks: [{ description: 'x', categoryId: 'nope' }],
      }),
    ).rejects.toThrow('Task 1: unknown category');
    expect(tasks.create).not.toHaveBeenCalled();

    const created = await importer.execute({
      userId: 'user-1',
      tasks: [
        { description: 'Milk' },
        { description: 'Report', scheduledAt: NOW, categoryId: 'c1' },
      ],
    });
    expect(created.map((t) => t.description)).toEqual(['Milk', 'Report']);
    expect(tasks.create).toHaveBeenCalledTimes(2);
  });
});
