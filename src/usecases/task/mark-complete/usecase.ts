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
      const now = new Date();

      // Recurring tasks never "complete" — they advance to the next
      // occurrence so the user keeps getting reminded.
      if (existing.recurrence && existing.scheduledAt) {
        // Idempotent: if the series already sits in the future (a stale
        // reminder message tapped twice, or two old messages tapped in a
        // row), don't skip a cycle.
        const meansThisOccurrence =
          input.occurrenceAt?.getTime() === existing.scheduledAt.getTime();
        if (
          existing.scheduledAt.getTime() > now.getTime() &&
          existing.status === TaskStatus.Pending &&
          !meansThisOccurrence
        ) {
          return { ...existing, alreadyDone: true };
        }
        const nextAt = computeNextOccurrence(
          existing.scheduledAt,
          existing.recurrence,
          now,
          existing.timezone,
        );
        // The series has an end date and this was its last occurrence.
        if (nextAt === null) {
          const finished = await this.taskRepository.update({
            id: input.taskId,
            status: TaskStatus.Completed,
            completedAt: now,
            snoozedUntil: null,
            pushCompletion: { at: now, occurrenceAt: existing.scheduledAt },
          });
          return { ...finished, alreadyDone: false };
        }
        // Moving scheduledAt (and clearing the snooze) moves nextFireAt past
        // lastSentAt, which re-arms the scheduler's once-per-fire reminder.
        const updated = await this.taskRepository.update({
          id: input.taskId,
          scheduledAt: nextAt,
          snoozedUntil: null,
          status: TaskStatus.Pending,
          pushCompletion: { at: now, occurrenceAt: existing.scheduledAt },
        });
        return { ...updated, alreadyDone: false };
      }

      if (existing.status === TaskStatus.Completed) {
        return { ...existing, alreadyDone: true };
      }

      const updated = await this.taskRepository.update({
        id: input.taskId,
        status: TaskStatus.Completed,
        completedAt: now,
      });
      return { ...updated, alreadyDone: false };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to mark task complete', error);
    }
  }
}
