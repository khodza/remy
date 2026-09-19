import { Injectable, Inject } from '@nestjs/common';
import { Task, TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { ApplicationError } from '@domain/error';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { InvalidInputError } from '@common/errors';
import { computeNextOccurrence } from '@common/recurrence';

/**
 * "Not this time": a repeating task moves on to its next occurrence without
 * counting as done. When the series has ended, the task is closed.
 */
@Injectable()
export class SkipOccurrenceUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: { taskId: string }): Promise<Task> {
    try {
      const task = await this.taskRepository.findById(input.taskId);
      if (!task)
        throw new TaskNotFoundError(`Task with id ${input.taskId} not found`);
      if (task.status !== TaskStatus.Pending) {
        throw new InvalidInputError('Only pending tasks can be skipped');
      }
      if (!task.recurrence || task.scheduledAt === null) {
        throw new InvalidInputError(
          'Only repeating tasks can skip an occurrence',
        );
      }
      const now = new Date();
      const next = computeNextOccurrence(
        task.scheduledAt,
        task.recurrence,
        now,
        task.timezone,
      );
      if (next === null) {
        return await this.taskRepository.update({
          id: task.id,
          status: TaskStatus.Completed,
          completedAt: now,
          snoozedUntil: null,
        });
      }
      return await this.taskRepository.update({
        id: task.id,
        scheduledAt: next,
        snoozedUntil: null,
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to skip occurrence', error);
    }
  }
}
