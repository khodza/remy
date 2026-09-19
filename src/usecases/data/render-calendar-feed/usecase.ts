import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { buildCalendar } from '@common/ical';
import { TaskStatus, type TaskRepository } from '@domain/task';
import type { UserRepository } from '@domain/user';
import { CALENDAR_TOKEN_PATTERN } from '../manage-calendar-feed';

export type RenderCalendarFeedInput = { token: string; now?: Date };

/** A calendar can hold a lot; far more than one person keeps pending. */
const MAX_EVENTS = 2000;

/**
 * The .ics behind the private link. Null for a malformed, replaced or
 * disabled token, so the caller answers 404 without saying which.
 */
@Injectable()
export class RenderCalendarFeedUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
  ) {}

  public async execute(input: RenderCalendarFeedInput): Promise<string | null> {
    if (!CALENDAR_TOKEN_PATTERN.test(input.token)) return null;
    const user = await this.users.findByCalendarToken(input.token);
    if (!user) return null;
    const tasks = await this.tasks.find({
      userId: user.id,
      statuses: [TaskStatus.Pending],
      kind: 'reminder',
      sort: 'dueAt',
      limit: MAX_EVENTS,
    });
    return buildCalendar({
      name: 'Remy',
      tasks,
      categoryNames: new Map(
        (user.categories ?? []).map((c) => [c.id, c.name]),
      ),
      now: input.now ?? new Date(),
    });
  }
}
