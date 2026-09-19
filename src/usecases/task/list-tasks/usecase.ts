import { Injectable, Inject } from '@nestjs/common';
import { Task, TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { dayBoundsInZone } from '@common/day-bounds';
import { effectiveDueAt } from '@common/fire-time';
import { ListTasksInput, ListTasksOutput, TaskWithOverdueFlag } from './types';

const DEFAULT_DONE_LIMIT = 50;

export function withOverdueFlag(task: Task, now: Date): TaskWithOverdueFlag {
  // A pending heads-up (nextFireAt before the due time) is not "overdue".
  const dueAt = effectiveDueAt(task);
  return {
    ...task,
    isOverdue:
      task.status === TaskStatus.Pending && dueAt !== null && dueAt < now,
  };
}

@Injectable()
export class ListTasksUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: ListTasksInput): Promise<ListTasksOutput> {
    const now = new Date();
    const tasks = await this.query(input, now);
    return { tasks: tasks.map((task) => withOverdueFlag(task, now)) };
  }

  private async query(input: ListTasksInput, now: Date): Promise<Task[]> {
    const { userId } = input;
    const view = input.view ?? 'all';
    const { start, end } = dayBoundsInZone(now, input.timezone ?? 'UTC');
    // `end` is exclusive; the filter is inclusive, so step back 1 ms.
    const endOfToday = new Date(end.getTime() - 1);

    switch (view) {
      case 'today': {
        const [due, doneToday] = await Promise.all([
          this.taskRepository.find({
            userId,
            statuses: [TaskStatus.Pending],
            kind: 'reminder',
            dueAtOrBefore: endOfToday,
            sort: 'dueAt',
          }),
          this.taskRepository.find({
            userId,
            statuses: [TaskStatus.Completed],
            completedAtOrAfter: start,
            sort: 'completedAtDesc',
          }),
        ]);
        return [...due, ...doneToday];
      }
      case 'upcoming':
        return this.taskRepository.find({
          userId,
          statuses: [TaskStatus.Pending],
          kind: 'reminder',
          dueAfter: endOfToday,
          sort: 'dueAt',
        });
      case 'inbox':
        return this.taskRepository.find({
          userId,
          statuses: [TaskStatus.Pending],
          kind: 'todo',
          sort: 'createdAtDesc',
        });
      case 'done':
        return this.taskRepository.find({
          userId,
          statuses: [TaskStatus.Completed],
          sort: 'completedAtDesc',
          limit: input.limit ?? DEFAULT_DONE_LIMIT,
        });
      case 'all':
        return this.taskRepository.find({
          userId,
          statuses: input.includeCompleted
            ? [TaskStatus.Pending, TaskStatus.Overdue, TaskStatus.Completed]
            : [TaskStatus.Pending, TaskStatus.Overdue],
          sort: 'dueAt',
        });
    }
  }
}
