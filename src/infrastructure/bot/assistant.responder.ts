import { Injectable, Logger } from '@nestjs/common';
import type { Context } from 'grammy';
import type { User } from '@domain/user';
import { InterpretationFailedError } from '@domain/assistant';
import {
  HandleMessageUsecase,
  taskIdsOf,
  type HandleMessageInput,
} from '@usecases/assistant';
import { RefreshPinnedAgendaUsecase } from '@usecases/rhythm';
import { presentAssistantResult } from './presenters/assistant.presenter';
import { escapeHtml } from './html';
import { resolveTimezone } from './user-input';

export type RespondOptions = Pick<
  HandleMessageInput,
  'source' | 'replyToMessageId' | 'quoted' | 'answersPendingQuestion'
> & {
  /** Shown above the answer for voice notes, so a mis-hearing is visible. */
  transcript?: string;
};

/**
 * Runs one user utterance through the assistant and sends the answer. Shared
 * by typed messages, voice notes and the buttons that stand in for typing
 * (answer options, "when?" for a forwarded message).
 */
@Injectable()
export class AssistantResponder {
  private readonly logger = new Logger(AssistantResponder.name);
  constructor(
    private readonly handleMessage: HandleMessageUsecase,
    private readonly pinnedAgenda: RefreshPinnedAgendaUsecase,
  ) {}

  public async respond(
    ctx: Context,
    user: User,
    text: string,
    options: RespondOptions,
  ): Promise<void> {
    const chatId = ctx.chat?.id ?? user.telegramUserId;
    const timezone = resolveTimezone(user);
    await ctx.replyWithChatAction('typing').catch(() => undefined);

    let result;
    try {
      result = await this.handleMessage.execute({
        userId: user.id,
        chatId,
        text,
        timezone,
        source: options.source,
        ...(options.replyToMessageId !== undefined
          ? { replyToMessageId: options.replyToMessageId }
          : {}),
        ...(options.quoted ? { quoted: options.quoted } : {}),
        ...(options.answersPendingQuestion
          ? { answersPendingQuestion: true }
          : {}),
      });
    } catch (error) {
      this.logger.error('Assistant failed', error);
      await ctx.reply(
        error instanceof InterpretationFailedError
          ? '🧠 I could not think just now (the AI service did not answer). Nothing was changed; please send that again in a moment.'
          : '❌ Something went wrong and nothing was changed. Please try again.',
      );
      return;
    }

    // Anything but talk may have changed today's picture.
    if (result.kind !== 'chat' && result.kind !== 'question') {
      this.pinnedAgenda.refreshSoon({ userId: user.id });
    }

    const reply = presentAssistantResult(result, timezone);
    const html = options.transcript
      ? `🎤 <i>“${escapeHtml(options.transcript)}”</i>\n\n${reply.html}`
      : reply.html;

    // The action is already done; a failed send must not look like a failure
    // to act (the user would repeat it and get duplicates).
    const sent = await ctx.reply(html, {
      parse_mode: 'HTML',
      ...(reply.keyboard ? { reply_markup: reply.keyboard } : {}),
    });

    const taskIds = taskIdsOf(result);
    if (taskIds.length > 0) {
      await this.handleMessage
        .linkReply(
          chatId,
          sent.message_id,
          taskIds,
          result.kind === 'agenda' ? 'agenda' : 'confirmation',
        )
        .catch((error: unknown) =>
          this.logger.error('Failed to link reply', error),
        );
    }
  }
}
