import { Injectable, Inject } from '@nestjs/common';
import { Task, TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { ApplicationError } from '@domain/error';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { InvalidInputError } from '@common/errors';

export type SnoozeTaskInput = { taskId: string; until: Date };
export type SnoozeTaskOutput = Task;

/** Snooze to an absolute time ("Tonight 20:00"), as opposed to DelayTask's "+N minutes". */
@Injectable()
export class SnoozeTaskUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: SnoozeTaskInput): Promise<SnoozeTaskOutput> {
    try {
      if (
        Number.isNaN(input.until.getTime()) ||
        input.until.getTime() <= Date.now()
      ) {
        throw new InvalidInputError('Snooze time must be in the future');
      }
      const task = await this.taskRepository.findById(input.taskId);
      if (!task) {
        throw new TaskNotFoundError(`Task with id ${input.taskId} not found`);
      }
      if (task.status !== TaskStatus.Pending) {
        throw new InvalidInputError('Only pending tasks can be snoozed');
      }
      if (task.scheduledAt === null) {
        throw new InvalidInputError(
          'This task has no time yet; schedule it instead of snoozing it',
        );
      }

      // Same rule as DelayTask: a recurring task keeps its series time.
      if (task.recurrence) {
        return await this.taskRepository.update({
          id: input.taskId,
          snoozedUntil: input.until,
          incrementSnoozeCount: true,
        });
      }
      return await this.taskRepository.update({
        id: input.taskId,
        scheduledAt: input.until,
        snoozedUntil: null,
        incrementSnoozeCount: true,
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to snooze task', error);
    }
  }
}
