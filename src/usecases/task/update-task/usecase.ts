import { Injectable, Inject } from '@nestjs/common';
import {
  type Priority,
  type Recurrence,
  type Task,
  type TaskRepository,
  type UpdateTaskParams,
  TaskStatus,
} from '@domain/task/repository';
import type { UserRepository } from '@domain/user';
import { Domain } from '@common/tokens';
import { ApplicationError } from '@domain/error';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { InvalidInputError } from '@common/errors';
import { assertCategoryBelongsToUser } from '../../category/assert-category';

/** undefined leaves a field alone; null clears it. */
export type UpdateTaskInput = {
  taskId: string;
  description?: string;
  notes?: string | null;
  /** null turns a reminder into a todo (clears recurrence, snooze, lead). */
  scheduledAt?: Date | null;
  recurrence?: Omit<Recurrence, 'anchorAt'> | null;
  priority?: Priority;
  categoryId?: string | null;
  leadMinutes?: number | null;
};
export type UpdateTaskOutput = Task;

@Injectable()
export class UpdateTaskUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  public async execute(input: UpdateTaskInput): Promise<UpdateTaskOutput> {
    try {
      const existing = await this.taskRepository.findById(input.taskId);
      if (!existing) {
        throw new TaskNotFoundError(`Task with id ${input.taskId} not found`);
      }
      if (existing.status !== TaskStatus.Pending) {
        throw new InvalidInputError('Only pending tasks can be edited');
      }
      if (input.description !== undefined && input.description.trim() === '') {
        throw new InvalidInputError('Description cannot be empty');
      }
      await assertCategoryBelongsToUser(
        this.userRepository,
        existing.userId,
        input.categoryId,
      );

      const params: UpdateTaskParams = { id: input.taskId };
      if (input.description !== undefined)
        params.description = input.description.trim();
      if (input.notes !== undefined) params.notes = input.notes;
      if (input.priority !== undefined) params.priority = input.priority;
      if (input.categoryId !== undefined) params.categoryId = input.categoryId;

      // The time the task will have after this update.
      const scheduledAt =
        input.scheduledAt !== undefined
          ? input.scheduledAt
          : existing.scheduledAt;

      if (input.scheduledAt !== undefined) {
        params.scheduledAt = input.scheduledAt;
        params.snoozedUntil = null; // a new time supersedes any snooze
      }

      if (scheduledAt === null) {
        // Todo: nothing time-based survives.
        if (input.recurrence) {
          throw new InvalidInputError('A recurring task needs a time');
        }
        if (input.leadMinutes) {
          throw new InvalidInputError('"Remind before" needs a time');
        }
        if (existing.recurrence) params.recurrence = null;
        if (existing.leadMinutes !== null) params.leadMinutes = null;
      } else {
        if (input.leadMinutes !== undefined)
          params.leadMinutes = input.leadMinutes;
        // A recurrence is anchored at its first occurrence. Setting a new
        // recurrence, or moving the series time, re-anchors it; editing only
        // other fields keeps the anchor.
        if (input.recurrence !== undefined) {
          params.recurrence = input.recurrence
            ? { ...input.recurrence, anchorAt: scheduledAt }
            : null;
        } else if (input.scheduledAt !== undefined && existing.recurrence) {
          params.recurrence = { ...existing.recurrence, anchorAt: scheduledAt };
        }
      }

      return await this.taskRepository.update(params);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to update task', error);
    }
  }
}
