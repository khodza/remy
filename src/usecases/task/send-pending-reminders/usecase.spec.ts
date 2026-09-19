import { SendPendingRemindersUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import type { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import type { ScheduledTask, Task } from '@domain/task';
import {
  makeTask,
  mockConversationRepository,
  mockTaskRepository,
} from '@test/factories';

describe('SendPendingRemindersUsecase', () => {
  let usecase: SendPendingRemindersUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;
  let notificationGateway: jest.Mocked<NotificationGateway>;
  let conversations: ReturnType<typeof mockConversationRepository>;

  const now = new Date('2026-04-16T12:00:00Z');

  /** Makes claimDueReminder hand out these tasks one per call, then null. */
  function queueClaims(tasks: Task[], previousLastSentAt?: Date) {
    const queue = [...tasks];
    taskRepository.claimDueReminder.mockImplementation(async () => {
      const task = queue.shift();
      return task
        ? {
            task: { ...task, lastSentAt: now } as ScheduledTask,
            previousLastSentAt,
          }
        : null;
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    taskRepository = mockTaskRepository();
    notificationGateway = {
      sendReminder: jest.fn().mockResolvedValue({ messageId: 900 }),
    };
    conversations = mockConversationRepository();
    usecase = new SendPendingRemindersUsecase(
      taskRepository,
      notificationGateway,
      conversations,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sends every claimed task and passes its timezone and fire time', async () => {
    const snoozed = makeTask({
      id: 'task-2',
      timezone: 'Asia/Tashkent',
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      snoozedUntil: new Date('2026-04-16T11:30:00Z'),
      recurrence: { type: 'daily' },
    });
    queueClaims([makeTask({ id: 'task-1' }), snoozed]);

    const result = await usecase.execute();

    expect(notificationGateway.sendReminder).toHaveBeenCalledTimes(2);
    expect(notificationGateway.sendReminder).toHaveBeenLastCalledWith({
      chatId: 12345,
      taskId: 'task-2',
      description: 'Buy groceries',
      kind: 'due',
      dueAt: new Date('2026-04-16T11:30:00Z'), // the snooze, not the series time
      timezone: 'Asia/Tashkent',
      notes: null,
      recurrence: { type: 'daily' },
    });
    // The reminder message is linked to its task so a reply can snooze it.
    expect(conversations.linkMessage).toHaveBeenLastCalledWith({
      chatId: 12345,
      messageId: 900,
      taskIds: ['task-2'],
      kind: 'reminder',
    });
    expect(result).toEqual({ sentCount: 2, failedCount: 0 });
    // The claim already stamped lastSentAt; no second write per task.
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('claims before sending, so a crash can never duplicate a reminder', async () => {
    queueClaims([makeTask()]);
    await usecase.execute();
    expect(
      taskRepository.claimDueReminder.mock.invocationCallOrder[0],
    ).toBeLessThan(
      notificationGateway.sendReminder.mock.invocationCallOrder[0]!,
    );
  });

  it('counts failed reminders without stopping', async () => {
    queueClaims([
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ]);
    notificationGateway.sendReminder
      .mockResolvedValueOnce({ messageId: 1 })
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce({ messageId: 2 });

    const result = await usecase.execute();

    expect(result).toEqual({ sentCount: 2, failedCount: 1 });
  });

  it('returns zeros when nothing is due', async () => {
    const result = await usecase.execute();
    expect(result).toEqual({ sentCount: 0, failedCount: 0 });
    expect(notificationGateway.sendReminder).not.toHaveBeenCalled();
  });

  it('stops the run when claiming fails', async () => {
    taskRepository.claimDueReminder.mockRejectedValue(new Error('db error'));
    const result = await usecase.execute();
    expect(result).toEqual({ sentCount: 0, failedCount: 0 });
  });

  it('keeps the claim after a permanent failure so it is not retried every minute', async () => {
    queueClaims([makeTask()]);
    notificationGateway.sendReminder.mockRejectedValue(
      new NotificationFailedError('bot was blocked', undefined, {
        permanent: true,
      }),
    );

    const result = await usecase.execute();

    expect(result.failedCount).toBe(1);
    expect(taskRepository.releaseReminderClaim).not.toHaveBeenCalled();
  });

  it('releases the claim with a retry hold after a transient failure', async () => {
    const previous = new Date('2026-04-15T12:00:00Z');
    queueClaims([makeTask()], previous);
    notificationGateway.sendReminder.mockRejectedValue(
      new NotificationFailedError('too many requests'),
    );

    const result = await usecase.execute();

    expect(result.failedCount).toBe(1);
    expect(taskRepository.releaseReminderClaim).toHaveBeenCalledWith(
      'task-1',
      previous,
      new Date('2026-04-16T12:02:00Z'),
    );
  });

  it('sends the "remind me before" heads-up first and records it before sending', async () => {
    const dueAt = new Date('2026-04-16T12:30:00Z');
    const task = makeTask({
      scheduledAt: dueAt,
      leadMinutes: 30,
      nextFireAt: new Date('2026-04-16T12:00:00Z'),
    });
    queueClaims([task]);
    taskRepository.update.mockResolvedValue(task);

    await usecase.execute();

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      leadSentFor: dueAt,
    });
    expect(notificationGateway.sendReminder).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'heads_up', dueAt }),
    );
    expect(taskRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
      notificationGateway.sendReminder.mock.invocationCallOrder[0]!,
    );
  });

  it('after the heads-up, the same task fires as a normal due reminder', async () => {
    const dueAt = new Date('2026-04-16T12:00:00Z');
    queueClaims([
      makeTask({ scheduledAt: dueAt, leadMinutes: 30, leadSentFor: dueAt }),
    ]);
    await usecase.execute();
    expect(notificationGateway.sendReminder).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'due' }),
    );
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('rolls an ignored recurring task onto its latest occurrence before sending', async () => {
    const task = makeTask({
      scheduledAt: new Date('2026-04-13T09:00:00Z'),
      snoozedUntil: new Date('2026-04-13T10:00:00Z'),
      recurrence: { type: 'daily' },
      lastSentAt: new Date('2026-04-13T10:00:00Z'),
    });
    taskRepository.findOverdueRecurring.mockResolvedValue([task]);

    await usecase.execute();

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      snoozedUntil: null,
    });
    expect(taskRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
      taskRepository.claimDueReminder.mock.invocationCallOrder[0]!,
    );
  });

  it('rolls over in the task timezone', async () => {
    // Tashkent (UTC+5): 09:00 local = 04:00Z. Three days behind.
    const task = makeTask({
      scheduledAt: new Date('2026-04-13T04:00:00Z'),
      timezone: 'Asia/Tashkent',
      recurrence: { type: 'daily' },
    });
    taskRepository.findOverdueRecurring.mockResolvedValue([task]);

    await usecase.execute();

    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: new Date('2026-04-16T04:00:00Z'),
      }),
    );
  });

  it('does not roll a recurring task whose next occurrence is still ahead', async () => {
    taskRepository.findOverdueRecurring.mockResolvedValue([
      makeTask({
        scheduledAt: new Date('2026-04-16T09:00:00Z'),
        recurrence: { type: 'daily' },
      }),
    ]);

    await usecase.execute();

    expect(taskRepository.update).not.toHaveBeenCalled();
  });
});
