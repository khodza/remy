import { SendPendingRemindersUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import type { NotificationGateway } from '@domain/notification/gateway';
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
    jest.spyOn(console, 'error').mockImplementation(() => {});

    taskRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findPendingReminders: jest.fn(),
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
});
