import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { InvalidInputError } from '@common/errors';
import type { Task } from '@domain/task';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import {
  CreateStructuredTaskUsecase,
  type CreateStructuredTaskInput,
} from '../../task/create-structured-task';
import { IMPORT_MAX_TASKS } from '../parse-list';
import { userZone } from '../zone';

export type ImportTaskFields = Omit<
  CreateStructuredTaskInput,
  'userId' | 'telegramChatId' | 'timezone'
>;
export type ImportTasksInput = { userId: string; tasks: ImportTaskFields[] };

/**
 * Creates reviewed drafts. Every row is checked before the first one is
 * saved, so a bad row fails the import instead of leaving half of it.
 */
@Injectable()
export class ImportTasksUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    private readonly createStructured: CreateStructuredTaskUsecase,
  ) {}

  public async execute(input: ImportTasksInput): Promise<Task[]> {
    if (input.tasks.length === 0)
      throw new InvalidInputError('Nothing to import');
    if (input.tasks.length > IMPORT_MAX_TASKS) {
      throw new InvalidInputError(
        `At most ${IMPORT_MAX_TASKS} tasks at a time`,
      );
    }
    const user = await this.users.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);
    const categoryIds = new Set((user.categories ?? []).map((c) => c.id));

    input.tasks.forEach((task, i) => {
      const row = `Task ${i + 1}`;
      const time = task.scheduledAt ?? null;
      if (task.description.trim() === '')
        throw new InvalidInputError(`${row}: the title is empty`);
      if (task.recurrence && !time)
        throw new InvalidInputError(`${row}: a repeating task needs a time`);
      if (task.allDay && !time)
        throw new InvalidInputError(`${row}: an all-day task needs a date`);
      if (task.leadMinutes && !time)
        throw new InvalidInputError(`${row}: "remind before" needs a time`);
      if (task.categoryId && !categoryIds.has(task.categoryId)) {
        throw new InvalidInputError(`${row}: unknown category`);
      }
    });

    const created: Task[] = [];
    for (const task of input.tasks) {
      created.push(
        await this.createStructured.execute({
          ...task,
          userId: user.id,
          telegramChatId: user.telegramUserId,
          timezone: userZone(user),
        }),
      );
    }
    return created;
  }
}
