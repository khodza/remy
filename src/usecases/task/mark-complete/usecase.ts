import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { MarkCompleteInput, MarkCompleteOutput } from './types';
import { ApplicationError } from '@domain/error';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { computeNextOccurrence } from '@common/recurrence';

@Injectable()
export class MarkCompleteUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: MarkCompleteInput): Promise<MarkCompleteOutput> {
    try {
      const existing = await this.taskRepository.findById(input.taskId);
      if (!existing) {
        throw new TaskNotFoundError(`Task with id ${input.taskId} not found`);
      }

      // Recurring tasks never "complete" — they advance to the next
      // occurrence so the user keeps getting reminded. The scheduler's
      // 1-minute dedupe window self-clears because the next fire is at
      // least a day away (or `intervalDays` days), so we don't need to
      // touch lastSentAt here.
      if (existing.recurrence) {
        const nextAt = computeNextOccurrence(
          existing.scheduledAt,
          existing.recurrence,
        );
        return await this.taskRepository.update({
          id: input.taskId,
          scheduledAt: nextAt,
          status: TaskStatus.Pending,
        });
      }

      return await this.taskRepository.update({
        id: input.taskId,
        status: TaskStatus.Completed,
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to mark task complete', error);
    }
  }
}
