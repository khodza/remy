import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import {
  buildCsvExport,
  buildJsonExport,
  exportFilename,
} from '@common/export-data';
import { TaskStatus, type TaskRepository } from '@domain/task';
import type { NotificationGateway } from '@domain/notification';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { userZone } from '../zone';

export type ExportDataInput = {
  userId: string;
  format: 'csv' | 'json';
  now?: Date;
};
export type ExportDataOutput = { filename: string; tasks: number };

/**
 * Everything (pending and done) as a file the bot sends to the chat. A Mini
 * App can't reliably download files on iOS; the chat can keep and share it.
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
