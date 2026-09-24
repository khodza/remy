import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import type { TaskRepository } from '@domain/task/repository';
import { NoSourceMessageError, TaskNotFoundError } from '@domain/task/errors';
import type { NotificationGateway } from '@domain/notification';

export type ShowTaskSourceInput = { taskId: string };
export type ShowTaskSourceOutput = { messageId: number | null };

/**
 * "Where did this come from?": the bot replies to the chat message the task
 * was made from, so the user can tap the quote and jump to it. A task made
 * in the Mini App has no such message (NoSourceMessageError); a deleted
 * message surfaces as SourceMessageGoneError from the gateway.
 */
@Injectable()
export class ShowTaskSourceUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
    @Inject(Domain.Notification.Gateway)
    private readonly notifications: NotificationGateway,
  ) {}

  public async execute(
    input: ShowTaskSourceInput,
  ): Promise<ShowTaskSourceOutput> {
    const task = await this.tasks.findById(input.taskId);
    if (!task) throw new TaskNotFoundError(`Task ${input.taskId} not found`);
    const messageId = task.source.messageId;
    if (messageId === null) {
      throw new NoSourceMessageError(
        'This task was not made from a chat message.',
      );
    }
    return this.notifications.sendSourceLink({
      chatId: task.telegramChatId,
      replyToMessageId: messageId,
      description: task.description,
    });
  }
}
