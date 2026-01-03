import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { DeleteTaskInput, DeleteTaskOutput } from './types';
import { ApplicationError } from '@domain/error';
import { FailedToUpdateTaskError } from '@domain/task/errors';

@Injectable()
export class DeleteTaskUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: DeleteTaskInput): Promise<DeleteTaskOutput> {
    try {
      // Soft delete: update status to deleted
      await this.taskRepository.update({
        id: input.taskId,
        status: TaskStatus.Deleted,
      });

      return { success: true };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to delete task', error);
    }
  }
}
