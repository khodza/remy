import { DeleteTaskUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import { FailedToUpdateTaskError } from '@domain/task/errors';

import { makeTask, mockTaskRepository } from '@test/factories';

describe('DeleteTaskUsecase', () => {
  let usecase: DeleteTaskUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T12:00:00Z');

  beforeEach(() => {
    taskRepository = mockTaskRepository();

    usecase = new DeleteTaskUsecase(taskRepository);
  });

  it('should soft-delete a task by setting status to Deleted', async () => {
    taskRepository.update.mockResolvedValue(
      makeTask({ scheduledAt: now, status: TaskStatus.Deleted }),
    );

    const result = await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Deleted,
    });
    expect(result).toEqual({ success: true });
  });

  it('should wrap unexpected errors in FailedToUpdateTaskError', async () => {
    taskRepository.update.mockRejectedValue(new Error('db error'));

    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toThrow(
      FailedToUpdateTaskError,
    );
  });
});
