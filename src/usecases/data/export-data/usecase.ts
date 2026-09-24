import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import {
  buildCsvExport,
  buildJsonExport,
  exportFilename,
} from '@common/export-data';
import { buildCalendar } from '@common/ical';
import { TaskStatus, type TaskRepository } from '@domain/task';
import type { NotificationGateway } from '@domain/notification';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { userZone } from '../zone';

export type ExportDataInput = {
  userId: string;
  format: 'csv' | 'json' | 'ics';
  now?: Date;
};

/** A calendar file can hold a lot; far more than one person keeps pending. */
const MAX_ICS_EVENTS = 2000;
export type ExportDataOutput = { filename: string; tasks: number };

/**
 * Everything (pending and done) as a file the bot sends to the chat. A Mini
 * App can't reliably download files on iOS; the chat can keep and share it.
 * `ics` is the calendar feed as a one-off file: the pending reminders only.
 * Local times are written in the profile zone (decision 8.7).
 */
@Injectable()
export class ExportDataUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
    @Inject(Domain.Notification.Gateway)
    private readonly notifications: NotificationGateway,
  ) {}

  public async execute(input: ExportDataInput): Promise<ExportDataOutput> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);
    const now = input.now ?? new Date();
    const timezone = userZone(user);
    if (input.format === 'ics') {
      const reminders = await this.tasks.find({
        userId: user.id,
        statuses: [TaskStatus.Pending],
        kind: 'reminder',
        sort: 'dueAt',
        limit: MAX_ICS_EVENTS,
      });
      const filename = exportFilename('ics', now, timezone);
      await this.notifications.sendDocument({
        chatId: user.telegramUserId,
        filename,
        content: buildCalendar({
          name: 'Remy',
          tasks: reminders,
          categoryNames: new Map(
            (user.categories ?? []).map((c) => [c.id, c.name]),
          ),
          now,
        }),
        caption: `📅 Your Remy calendar: ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}. Import it into Google or Apple Calendar.`,
      });
      return { filename, tasks: reminders.length };
    }
    const tasks = await this.tasks.findByUserId(user.id);
    const data = {
      timezone,
      settings: user.settings,
      categories: user.categories ?? [],
      tasks,
      now,
    };
    const content =
      input.format === 'csv' ? buildCsvExport(data) : buildJsonExport(data);
    const filename = exportFilename(input.format, now, timezone);
    const open = tasks.filter((t) => t.status === TaskStatus.Pending).length;

    await this.notifications.sendDocument({
      chatId: user.telegramUserId,
      filename,
      content,
      caption: `📦 Your Remy export: ${tasks.length} tasks (${open} open, ${tasks.length - open} done).`,
    });
    return { filename, tasks: tasks.length };
  }
}
