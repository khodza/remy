import { UndoActionUsecase } from './usecase';
import { UndoRecorder } from '../undo-recorder';
import { TaskStatus } from '@domain/task';
import {
  makeTask,
  makeUser,
  mockConversationRepository,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';

describe('UndoActionUsecase', () => {
  const now = new Date('2026-09-18T10:00:00Z');
  let tasks: ReturnType<typeof mockTaskRepository>;
  let conversations: ReturnType<typeof mockConversationRepository>;
  let recorder: UndoRecorder;
  let users: ReturnType<typeof mockUserRepository>;
  let usecase: UndoActionUsecase;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    tasks = mockTaskRepository();
    tasks.update.mockImplementation(async () => makeTask());
    conversations = mockConversationRepository();
    recorder = new UndoRecorder(conversations);
    users = mockUserRepository(makeUser({ timezone: 'Europe/Berlin' }));
    usecase = new UndoActionUsecase(conversations, tasks, users);
  });
  afterEach(() => jest.useRealTimers());

  it('deletes what the action created', async () => {
    const undoId = await recorder.record({
      chatId: 42,
      userId: 'user-1',
      label: 'created 2 tasks',
      createdTaskIds: ['a', 'b'],
    });
    await expect(
      usecase.execute({ undoId, chatId: 42, userId: 'user-1' }),
    ).resolves.toEqual({
      undone: true,
      label: 'created 2 tasks',
      taskIds: ['a', 'b'],
    });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'a',
      status: TaskStatus.Deleted,
    });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'b',
      status: TaskStatus.Deleted,
    });
  });

  it('restores a recurring task to before its Done, including the history', async () => {
    const before = makeTask({
      id: 'gym',
      scheduledAt: new Date('2026-09-18T02:00:00Z'),
      snoozedUntil: new Date('2026-09-18T03:00:00Z'),
      recurrence: { type: 'daily' },
      completions: [
        {
          at: new Date('2026-09-17T02:10:00Z'),
          occurrenceAt: new Date('2026-09-17T02:00:00Z'),
        },
      ],
    });
    const undoId = await recorder.record({
      chatId: 42,
      userId: 'user-1',
      label: 'completed "Gym"',
      before: [before],
    });
    await usecase.execute({ undoId, chatId: 42, userId: 'user-1' });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'gym',
      status: TaskStatus.Pending,
      description: before.description,
      notes: null,
      scheduledAt: before.scheduledAt,
      snoozedUntil: before.snoozedUntil,
      completedAt: null,
      recurrence: { type: 'daily' },
      truncateCompletions: 1,
      // A restored time would otherwise reset these (no more nudges).
      nudgeAt: before.nudgeAt,
      nudgeCount: before.nudgeCount,
      snoozeCount: before.snoozeCount,
    });
  });

  it('puts the previous timezone back, including "not set"', async () => {
    const undoId = await recorder.record({
      chatId: 42,
      userId: 'user-1',
      label: 'set the timezone to Europe/Berlin',
      restoreTimezone: 'Asia/Tashkent',
    });
    await usecase.execute({ undoId, chatId: 42, userId: 'user-1' });
    expect(users.current().timezone).toBe('Asia/Tashkent');
    expect(tasks.update).not.toHaveBeenCalled();

    const unset = await recorder.record({
      chatId: 42,
      userId: 'user-1',
      label: 'set the timezone to Europe/Berlin',
      restoreTimezone: null,
    });
    await usecase.execute({ undoId: unset, chatId: 42, userId: 'user-1' });
    expect(users.current().timezone).toBeNull();
  });

  it('an ordinary undo leaves the timezone alone', async () => {
    const undoId = await recorder.record({
      chatId: 42,
      userId: 'user-1',
      label: 'deleted "x"',
      before: [makeTask()],
    });
    await usecase.execute({ undoId, chatId: 42, userId: 'user-1' });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('works once, only in its chat, only for its owner, only within the window', async () => {
    const make = () =>
      recorder.record({
        chatId: 42,
        userId: 'user-1',
        label: 'x',
        createdTaskIds: ['a'],
      });
    const expired = { undone: false, reason: 'expired_or_used' };

    const once = await make();
    await usecase.execute({ undoId: once, chatId: 42, userId: 'user-1' });
    await expect(
      usecase.execute({ undoId: once, chatId: 42, userId: 'user-1' }),
    ).resolves.toEqual(expired);

    await expect(
      usecase.execute({ undoId: await make(), chatId: 7, userId: 'user-1' }),
    ).resolves.toEqual(expired);
    await expect(
      usecase.execute({ undoId: await make(), chatId: 42, userId: 'intruder' }),
    ).resolves.toEqual(expired);

    const late = await make();
    jest.setSystemTime(new Date('2026-09-18T10:11:00Z'));
    await expect(
      usecase.execute({ undoId: late, chatId: 42, userId: 'user-1' }),
    ).resolves.toEqual(expired);
    expect(tasks.update).toHaveBeenCalledTimes(1);
  });
});
