import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Domain } from '@common/tokens';
import type { ConversationRepository } from '@domain/conversation';
import type { GoogleConnectionRepository } from '@domain/integrations/google-calendar';
import type { TaskRepository } from '@domain/task';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';

export type DeleteAllDataInput = { userId: string };
export type DeleteAllDataOutput = { deletedTasks: number };

/**
 * "Delete all my data": every task (for good, not the 30-day soft delete),
 * categories, conversation memory (message links, questions, undo records,
 * reviews), the calendar feed link, the Google Calendar connection, and the
 * settings back to defaults. The account stays so the owner can keep using Remy from a clean slate.
 */
@Injectable()
export class DeleteAllDataUsecase {
  private readonly logger = new Logger(DeleteAllDataUsecase.name);

  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
    @Optional()
    @Inject(Domain.Integrations.GoogleConnectionRepository)
    private readonly google?: GoogleConnectionRepository,
  ) {}

  public async execute(
    input: DeleteAllDataInput,
  ): Promise<DeleteAllDataOutput> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);
    // Feed first: the private link must stop working even if a later step fails.
    await this.users.update({
      id: user.id,
      calendarToken: null,
      settings: null,
      categories: null,
    });
    const deletedTasks = await this.tasks.deleteAllForUser(user.id);
    // The bot talks to the owner in their private chat: chat id = user id.
    await this.conversations.deleteAllForChat(user.telegramUserId);
    await this.google?.delete(user.id);
    this.logger.log(
      `Deleted all data of user ${user.id} (${deletedTasks} tasks)`,
    );
    return { deletedTasks };
  }
}
