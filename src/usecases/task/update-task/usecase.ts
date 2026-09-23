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
import { allDayFireTime } from '@common/all-day';
import { normaliseListName } from '@common/list-name';
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
  /** true = a date with no time (the time moves to 09:00 local that day). */
  allDay?: boolean;
  /** Named list, normalised; null takes the task off its list. */
  list?: string | null;
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
      if (input.list !== undefined) params.list = normaliseListName(input.list);

      // The time the task will have after this update. An all-day task sits
      // at 09:00 on its date; turning allDay on (or moving an all-day task)
      // normalises the time, which counts as a new time.
      const timeAfter =
        input.scheduledAt !== undefined
          ? input.scheduledAt
          : existing.scheduledAt;
      if (input.allDay === true && timeAfter === null) {
        throw new InvalidInputError('An all-day task needs a date');
      }
      const allDay = (input.allDay ?? existing.allDay) && timeAfter !== null;
      let newTime = input.scheduledAt;
      if (allDay && timeAfter !== null) {
        const normalised = allDayFireTime(timeAfter, existing.timezone);
        if (
          input.scheduledAt !== undefined ||
          normalised.getTime() !== existing.scheduledAt?.getTime()
        ) {
          newTime = normalised;
        }
      }
      if (allDay !== existing.allDay) params.allDay = allDay;

      const scheduledAt =
        newTime !== undefined ? newTime : existing.scheduledAt;

      if (newTime !== undefined) {
        params.scheduledAt = newTime;
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
        } else if (newTime !== undefined && existing.recurrence) {
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
