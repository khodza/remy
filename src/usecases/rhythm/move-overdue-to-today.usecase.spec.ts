import {
  MoveOverdueToTodayUsecase,
  todayAtSameTime,
} from './move-overdue-to-today.usecase';
import { UndoRecorder } from '../assistant/undo-recorder';
import { TaskStatus } from '@domain/task';
import {
  makeTask,
  mockConversationRepository,
  mockTaskRepository,
} from '@test/factories';
import type { SnoozeTaskUsecase } from '../task/snooze-task';

const tz = 'Asia/Tashkent';
const now = new Date('2026-09-17T04:30:00Z'); // Thu 09:30 local

describe('todayAtSameTime', () => {
  it('keeps the time of day when it is still ahead today', () => {
    // due Tue 18:00 local → today 18:00
    expect(todayAtSameTime(new Date('2026-09-15T13:00:00Z'), now, tz)).toEqual(
      new Date('2026-09-17T13:00:00Z'),
    );
  });
  it('goes to the next full hour when that time has passed', () => {
    // due Tue 08:00 local → today 10:00 (it is 09:30)
    expect(todayAtSameTime(new Date('2026-09-15T03:00:00Z'), now, tz)).toEqual(
      new Date('2026-09-17T05:00:00Z'),
    );
  });
});

describe('MoveOverdueToTodayUsecase', () => {
  beforeEach(() => jest.useFakeTimers({ now }));
  afterEach(() => jest.useRealTimers());

  it('moves only tasks that are still overdue and yours, with one undo', async () => {
    const tasks = mockTaskRepository();
    const byId: Record<string, ReturnType<typeof makeTask>> = {
      old: makeTask({
        id: 'old',
        scheduledAt: new Date('2026-09-15T13:00:00Z'),
      }),
      today: makeTask({
        id: 'today',
        scheduledAt: new Date('2026-09-17T08:00:00Z'),
      }),
      done: makeTask({
        id: 'done',
        scheduledAt: new Date('2026-09-15T13:00:00Z'),
        status: TaskStatus.Completed,
      }),
      foreign: makeTask({
        id: 'foreign',
        userId: 'other',
        scheduledAt: new Date('2026-09-15T13:00:00Z'),
      }),
    };
    tasks.findById.mockImplementation(async (id: string) => byId[id] ?? null);
    const snooze = {
      execute: jest.fn(async ({ taskId, until }) =>
        makeTask({ id: taskId, scheduledAt: until }),
      ),
    };
    const conversations = mockConversationRepository();
    const usecase = new MoveOverdueToTodayUsecase(
      tasks,
      snooze as unknown as SnoozeTaskUsecase,
      new UndoRecorder(conversations),
    );

    const result = await usecase.execute({
      userId: 'user-1',
      chatId: 42,
      timezone: tz,
      taskIds: ['today', 'old', 'done', 'foreign', 'gone'],
    });

    expect(snooze.execute).toHaveBeenCalledTimes(1);
    expect(snooze.execute).toHaveBeenCalledWith({
      taskId: 'old',
      until: new Date('2026-09-17T13:00:00Z'),
    });
    expect(result.tasks.map((t) => t.id)).toEqual(['old']);
    expect(
      conversations.undos.get(result.undoId!)?.snapshots.map((s) => s.taskId),
    ).toEqual(['old']);
  });

  it('nothing overdue → nothing moved, no undo', async () => {
    const tasks = mockTaskRepository();
    tasks.findById.mockResolvedValue(null);
    const usecase = new MoveOverdueToTodayUsecase(
      tasks,
      { execute: jest.fn() } as unknown as SnoozeTaskUsecase,
      new UndoRecorder(mockConversationRepository()),
    );
    expect(
      await usecase.execute({
        userId: 'user-1',
        chatId: 42,
        timezone: tz,
        taskIds: ['x'],
      }),
    ).toEqual({ tasks: [], undoId: null });
  });
});
