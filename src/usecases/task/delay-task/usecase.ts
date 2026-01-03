import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { DelayTaskInput, DelayTaskOutput } from './types';
import { ApplicationError } from '@domain/error';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { addMinutes } from 'date-fns';
import { validateDelayMinutes } from '@common/validation';

@Injectable()
export class DelayTaskUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: DelayTaskInput): Promise<DelayTaskOutput> {
    try {
      // Validate delay minutes
      validateDelayMinutes(input.delayMinutes);

      // Find task
      const task = await this.taskRepository.findById(input.taskId);
      if (task === null) {
        throw new TaskNotFoundError(`Task with id ${input.taskId} not found`);
      }

      // Calculate new scheduled time
      const newScheduledAt = addMinutes(task.scheduledAt, input.delayMinutes);

      // Update task
      const updatedTask = await this.taskRepository.update({
        id: input.taskId,
        scheduledAt: newScheduledAt,
      });

      return updatedTask;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to delay task', error);
    }
  }
}
