import { Injectable, Inject } from '@nestjs/common';
import { Task, TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { ApplicationError } from '@domain/error';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { InvalidInputError } from '@common/errors';

export type ReopenTaskInput = { taskId: string };
export type ReopenTaskOutput = Task;

/** Undo for "Done": a completed task becomes pending again. */
@Injectable()
export class ReopenTaskUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: ReopenTaskInput): Promise<ReopenTaskOutput> {
    try {
      const task = await this.taskRepository.findById(input.taskId);
      if (!task) {
        throw new TaskNotFoundError(`Task with id ${input.taskId} not found`);
      }
      if (task.status === TaskStatus.Pending) return task;
      if (task.status !== TaskStatus.Completed) {
        throw new InvalidInputError('Only completed tasks can be reopened');
      }
      return await this.taskRepository.update({
        id: input.taskId,
        status: TaskStatus.Pending,
        completedAt: null,
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to reopen task', error);
    }
  }
}
