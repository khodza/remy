import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { MarkCompleteInput, MarkCompleteOutput } from './types';
import { ApplicationError } from '@domain/error';
import { FailedToUpdateTaskError } from '@domain/task/errors';

@Injectable()
export class MarkCompleteUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: MarkCompleteInput): Promise<MarkCompleteOutput> {
    try {
      const task = await this.taskRepository.update({
        id: input.taskId,
        status: TaskStatus.Completed,
      });

      return task;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to mark task complete', error);
    }
  }
}
