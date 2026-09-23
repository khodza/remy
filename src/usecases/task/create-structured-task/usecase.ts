import { Injectable, Inject } from '@nestjs/common';
import type {
  Priority,
  Recurrence,
  Task,
  TaskRepository,
} from '@domain/task/repository';
import type { TaskSourceType } from '@domain/task';
import type { UserRepository } from '@domain/user';
import { allDayFireTime } from '@common/all-day';
import { normaliseListName } from '@common/list-name';
import { Domain } from '@common/tokens';
import { ApplicationError } from '@domain/error';
import { FailedToCreateTaskError } from '@domain/task/errors';
import { InvalidInputError } from '@common/errors';
import { assertCategoryBelongsToUser } from '../../category/assert-category';

export type CreateStructuredTaskInput = {
  userId: string;
  telegramChatId: number;
  timezone: string;
  description: string;
  notes?: string | null;
  /** Null or undefined creates a todo (Inbox). */
  scheduledAt?: Date | null;
  recurrence?: Omit<Recurrence, 'anchorAt'> | null;
  priority?: Priority;
  categoryId?: string | null;
  leadMinutes?: number | null;
  /** A date with no time: scheduledAt moves to 09:00 local that day. */
  allDay?: boolean;
  /** Named list; normalised ("My Shopping List" → "shopping"). */
  list?: string | null;
  /** What the user typed before reviewing the parsed fields. */
  originalText?: string;
  /** Where it came from; the Mini App unless said otherwise. */
  sourceType?: TaskSourceType;
};
export type CreateStructuredTaskOutput = Task;

/**
 * Creates a task from fields the user already reviewed in the Mini App.
 * Nothing is parsed, so what they saw is exactly what is saved.
 */
@Injectable()
export class CreateStructuredTaskUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  public async execute(
    input: CreateStructuredTaskInput,
  ): Promise<CreateStructuredTaskOutput> {
    try {
      const description = input.description.trim();
      if (description === '') {
        throw new InvalidInputError('Description cannot be empty');
      }
      let scheduledAt = input.scheduledAt ?? null;
      if (input.allDay && scheduledAt === null) {
        throw new InvalidInputError('An all-day task needs a date');
      }
      if (input.allDay && scheduledAt !== null) {
        scheduledAt = allDayFireTime(scheduledAt, input.timezone);
      }
      if (input.recurrence && scheduledAt === null) {
        throw new InvalidInputError('A recurring task needs a time');
      }
      if (input.leadMinutes && scheduledAt === null) {
        throw new InvalidInputError('"Remind before" needs a time');
      }
      await assertCategoryBelongsToUser(
        this.userRepository,
        input.userId,
        input.categoryId,
      );

      return await this.taskRepository.create({
        userId: input.userId,
        telegramChatId: input.telegramChatId,
        description,
        notes: input.notes ?? null,
        scheduledAt,
        timezone: input.timezone,
        recurrence:
          input.recurrence && scheduledAt
            ? { ...input.recurrence, anchorAt: scheduledAt }
            : null,
        priority: input.priority ?? 'normal',
        categoryId: input.categoryId ?? null,
        leadMinutes: input.leadMinutes ?? null,
        allDay: input.allDay === true,
        list: normaliseListName(input.list),
        source: {
          type: input.sourceType ?? 'miniapp',
          originalText: input.originalText ?? null,
          messageId: null,
          forwardedFrom: null,
        },
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToCreateTaskError('Failed to create task', error);
    }
  }
}
