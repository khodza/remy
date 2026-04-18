import { ListTasksUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import type { Task } from '@domain/task';

describe('ListTasksUsecase', () => {
  let usecase: ListTasksUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T12:00:00Z');
  const past = new Date('2026-04-15T10:00:00Z');
  const future = new Date('2026-04-17T10:00:00Z');

  const makeTask = (overrides: Partial<Task>): Task => ({
    id: 'task-1',
    userId: 'user-1',
    telegramChatId: 12345,
    description: 'Test task',
    scheduledAt: future,
    status: TaskStatus.Pending,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);

    taskRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findPendingReminders: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    usecase = new ListTasksUsecase(taskRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return pending tasks with overdue flag', async () => {
    const tasks = [
      makeTask({ id: 'task-1', scheduledAt: past }),
      makeTask({ id: 'task-2', scheduledAt: future }),
    ];
    taskRepository.findByUserId.mockResolvedValue(tasks);

    const result = await usecase.execute({ userId: 'user-1' });

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]!.isOverdue).toBe(true); // past scheduledAt
    expect(result.tasks[1]!.isOverdue).toBe(false); // future scheduledAt
  });

  it('should filter out deleted tasks', async () => {
    const tasks = [
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', status: TaskStatus.Deleted }),
    ];
    taskRepository.findByUserId.mockResolvedValue(tasks);

    const result = await usecase.execute({ userId: 'user-1' });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.id).toBe('task-1');
  });

  it('should filter out completed tasks by default', async () => {
    const tasks = [
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', status: TaskStatus.Completed }),
    ];
    taskRepository.findByUserId.mockResolvedValue(tasks);

    const result = await usecase.execute({ userId: 'user-1' });

    expect(result.tasks).toHaveLength(1);
  });

  it('should include completed tasks when includeCompleted is true', async () => {
    const tasks = [
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', status: TaskStatus.Completed }),
    ];
    taskRepository.findByUserId.mockResolvedValue(tasks);

    const result = await usecase.execute({
      userId: 'user-1',
      includeCompleted: true,
    });

    expect(result.tasks).toHaveLength(2);
  });

  it('should return empty array when user has no tasks', async () => {
    taskRepository.findByUserId.mockResolvedValue([]);

    const result = await usecase.execute({ userId: 'user-1' });

    expect(result.tasks).toEqual([]);
  });

  it('should not mark completed tasks as overdue', async () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        status: TaskStatus.Completed,
        scheduledAt: past,
      }),
    ];
    taskRepository.findByUserId.mockResolvedValue(tasks);

    const result = await usecase.execute({
      userId: 'user-1',
      includeCompleted: true,
    });

    expect(result.tasks[0]!.isOverdue).toBe(false);
  });
});
