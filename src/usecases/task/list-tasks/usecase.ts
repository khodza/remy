import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { ListTasksInput, ListTasksOutput, TaskWithOverdueFlag } from './types';

@Injectable()
export class ListTasksUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: ListTasksInput): Promise<ListTasksOutput> {
    // Get all non-deleted tasks for user
    const allTasks = await this.taskRepository.findByUserId(input.userId);

    // Filter out deleted tasks and optionally completed tasks
    const filteredTasks = allTasks.filter((task) => {
      if (task.status === TaskStatus.Deleted) return false;
      if (!input.includeCompleted && task.status === TaskStatus.Completed)
        return false;
      return true;
    });

    // Compute overdue flag
    const now = new Date();
    const tasksWithOverdueFlag: TaskWithOverdueFlag[] = filteredTasks.map(
      (task) => ({
        ...task,
        isOverdue: task.status === TaskStatus.Pending && task.scheduledAt < now,
      }),
    );

    return {
      tasks: tasksWithOverdueFlag,
    };
  }
}
