import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { DelayTaskInput, DelayTaskOutput } from './types';
import { ApplicationError } from '@domain/error';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { InvalidInputError } from '@common/errors';
import { addMinutes, max } from 'date-fns';
import { validateDelayMinutes } from '@common/validation';

@Injectable()
export class DelayTaskUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: DelayTaskInput): Promise<DelayTaskOutput> {
    try {
      validateDelayMinutes(input.delayMinutes);

      const task = await this.taskRepository.findById(input.taskId);
      if (task === null) {
        throw new TaskNotFoundError(`Task with id ${input.taskId} not found`);
      }
      if (task.status !== TaskStatus.Pending) {
        throw new InvalidInputError('Only pending tasks can be delayed');
      }

      // Snoozing an overdue task counts from now: adding to the old time
      // would leave it in the past, and the reminder would fire again
      // immediately.
      const from = max([task.nextFireAt, new Date()]);
      const until = addMinutes(from, input.delayMinutes);

      // A recurring task keeps its series time; only this occurrence moves.
      // Otherwise "daily at 09:00" snoozed by an hour becomes "daily at
      // 10:00" forever.
      if (task.recurrence) {
        return await this.taskRepository.update({
          id: input.taskId,
          snoozedUntil: until,
        });
      }

      return await this.taskRepository.update({
        id: input.taskId,
        scheduledAt: until,
        snoozedUntil: null,
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to delay task', error);
    }
  }
}
