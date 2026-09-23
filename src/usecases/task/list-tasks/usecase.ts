import { Injectable, Inject } from '@nestjs/common';
import {
  Task,
  TaskFilter,
  TaskRepository,
  TaskStatus,
} from '@domain/task/repository';
import { normaliseListName } from '@common/list-name';
import { Domain } from '@common/tokens';
import { dayBoundsInZone } from '@common/day-bounds';
import { isTaskOverdue } from '@common/all-day';
import { ListTasksInput, ListTasksOutput, TaskWithOverdueFlag } from './types';

const DEFAULT_DONE_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 50;

export function withOverdueFlag(task: Task, now: Date): TaskWithOverdueFlag {
  // A pending heads-up (nextFireAt before the due time) is not "overdue";
  // an all-day task is only once its day is over.
  return { ...task, isOverdue: isTaskOverdue(task, now) };
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
    const list =
      input.list !== undefined ? normaliseListName(input.list) : undefined;
    // A list name that normalises to nothing matches nothing.
    if (list === null) return [];
    // Every query below is scoped to the list when one was asked for.
    const userId = input.userId;
    const find = (filter: Omit<TaskFilter, 'userId'>) =>
      this.taskRepository.find({
        ...filter,
        userId,
        ...(list !== undefined ? { list } : {}),
      });

    if (input.search !== undefined) {
      const words = input.search.split(/\s+/).filter(Boolean);
      const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
      const pending = await find({
        statuses: [TaskStatus.Pending],
        search: words,
        sort: 'dueAt',
        limit,
      });
      if (pending.length >= limit) return pending;
      const done = await find({
        statuses: [TaskStatus.Completed],
        search: words,
        sort: 'completedAtDesc',
        limit: limit - pending.length,
      });
      return [...pending, ...done];
    }

    const view = input.view ?? 'all';
    const { start, end } = dayBoundsInZone(now, input.timezone ?? 'UTC');
    // `end` is exclusive; the filter is inclusive, so step back 1 ms.
    const endOfToday = new Date(end.getTime() - 1);

    switch (view) {
      case 'today': {
        const [due, doneToday] = await Promise.all([
          find({
            statuses: [TaskStatus.Pending],
            kind: 'reminder',
            dueAtOrBefore: endOfToday,
            sort: 'dueAt',
          }),
          find({
            statuses: [TaskStatus.Completed],
            completedAtOrAfter: start,
            sort: 'completedAtDesc',
          }),
        ]);
        return [...due, ...doneToday];
      }
      case 'upcoming':
        return find({
          statuses: [TaskStatus.Pending],
          kind: 'reminder',
          dueAfter: endOfToday,
          sort: 'dueAt',
        });
      case 'inbox':
        return find({
          statuses: [TaskStatus.Pending],
          kind: 'todo',
          sort: 'createdAtDesc',
        });
      case 'done':
        return find({
          statuses: [TaskStatus.Completed],
          sort: 'completedAtDesc',
          limit: input.limit ?? DEFAULT_DONE_LIMIT,
        });
      case 'all':
        return find({
          statuses: input.includeCompleted
            ? [TaskStatus.Pending, TaskStatus.Overdue, TaskStatus.Completed]
            : [TaskStatus.Pending, TaskStatus.Overdue],
          sort: 'dueAt',
        });
    }
  }
}
