import { SendPendingRemindersUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import type { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import { TaskStatus } from '@domain/task';
import type { Task } from '@domain/task';

describe('SendPendingRemindersUsecase', () => {
  let usecase: SendPendingRemindersUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;
  let notificationGateway: jest.Mocked<NotificationGateway>;

  const now = new Date('2026-04-16T12:00:00Z');

  const makeTask = (id: string): Task => ({
    id,
    userId: 'user-1',
    telegramChatId: 12345,
    description: `Task ${id}`,
    scheduledAt: new Date('2026-04-16T11:00:00Z'),
    status: TaskStatus.Pending,
    createdAt: now,
    updatedAt: now,
  });

  beforeEach(() => {
    jest.useFakeTimers({ now });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    taskRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findPendingReminders: jest.fn(),
      findOverdueRecurring: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
    };

    notificationGateway = {
      sendReminder: jest.fn(),
    };

    usecase = new SendPendingRemindersUsecase(
      taskRepository,
      notificationGateway,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should send reminders for all pending tasks', async () => {
    const tasks = [makeTask('task-1'), makeTask('task-2')];
    taskRepository.findPendingReminders.mockResolvedValue(tasks);
    taskRepository.update.mockResolvedValue(tasks[0]!);

    const result = await usecase.execute();

    expect(notificationGateway.sendReminder).toHaveBeenCalledTimes(2);
    expect(taskRepository.update).toHaveBeenCalledTimes(2);
    expect(result.sentCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  it('should count failed reminders without stopping', async () => {
    const tasks = [makeTask('task-1'), makeTask('task-2'), makeTask('task-3')];
    taskRepository.findPendingReminders.mockResolvedValue(tasks);
    notificationGateway.sendReminder
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce(undefined);
    taskRepository.update.mockResolvedValue(tasks[0]!);

    const result = await usecase.execute();

    expect(result.sentCount).toBe(2);
    expect(result.failedCount).toBe(1);
  });

  it('should return zeros when no pending tasks exist', async () => {
    taskRepository.findPendingReminders.mockResolvedValue([]);

    const result = await usecase.execute();

    expect(result.sentCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(notificationGateway.sendReminder).not.toHaveBeenCalled();
  });

  it('should handle fetch error gracefully', async () => {
    taskRepository.findPendingReminders.mockRejectedValue(
      new Error('db error'),
    );

    const result = await usecase.execute();

    expect(result.sentCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  it('should update lastSentAt after successful send', async () => {
    const task = makeTask('task-1');
    taskRepository.findPendingReminders.mockResolvedValue([task]);
    taskRepository.update.mockResolvedValue(task);

    await usecase.execute();

    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        lastSentAt: expect.any(Date) as Date,
      }),
    );
  });

  it('should stop retrying a reminder that failed permanently', async () => {
    const task = makeTask('task-1');
    taskRepository.findPendingReminders.mockResolvedValue([task]);
    taskRepository.update.mockResolvedValue(task);
    notificationGateway.sendReminder.mockRejectedValue(
      new NotificationFailedError('bot was blocked', undefined, {
        permanent: true,
      }),
    );

    const result = await usecase.execute();

    expect(result.failedCount).toBe(1);
    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      lastSentAt: now,
    });
  });

  it('should leave transient failures to be retried on the next run', async () => {
    const task = makeTask('task-1');
    taskRepository.findPendingReminders.mockResolvedValue([task]);
    notificationGateway.sendReminder.mockRejectedValue(
      new NotificationFailedError('too many requests'),
    );

    const result = await usecase.execute();

    expect(result.failedCount).toBe(1);
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('should roll an ignored recurring task onto its latest occurrence before sending', async () => {
    const task: Task = {
      ...makeTask('task-1'),
      scheduledAt: new Date('2026-04-13T09:00:00Z'),
      recurrence: { type: 'daily' },
      lastSentAt: new Date('2026-04-13T09:00:00Z'),
    };
    taskRepository.findOverdueRecurring.mockResolvedValue([task]);
    taskRepository.findPendingReminders.mockResolvedValue([]);

    await usecase.execute();

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
    });
    expect(taskRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
      taskRepository.findPendingReminders.mock.invocationCallOrder[0]!,
    );
  });

  it('should not roll a recurring task whose next occurrence is still ahead', async () => {
    const task: Task = {
      ...makeTask('task-1'),
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      recurrence: { type: 'daily' },
    };
    taskRepository.findOverdueRecurring.mockResolvedValue([task]);
    taskRepository.findPendingReminders.mockResolvedValue([]);

    await usecase.execute();

    expect(taskRepository.update).not.toHaveBeenCalled();
  });
});
