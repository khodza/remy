import { Injectable } from '@nestjs/common';
import { GrammyError, InlineKeyboard, InputFile } from 'grammy';
import { formatInTimeZone } from 'date-fns-tz';
import { addMinutes, differenceInMinutes } from 'date-fns';
import { NotificationGateway } from '@domain/notification/gateway';
import {
  SendDocumentInput,
  SendReminderInput,
  SendSourceLinkInput,
  SentReminder,
} from '@domain/notification/gateway/types';
import {
  NotificationFailedError,
  SourceMessageGoneError,
} from '@domain/notification/errors';
import type { Digest, PinnedAgenda } from '@domain/rhythm';
import { TelegramBotService } from '../bot.service';
import {
  presentDigest,
  presentPinnedAgenda,
} from '../presenters/rhythm.presenter';
import { isNotModifiedError } from '../telegram-safe';
import { escapeHtml } from '../html';
import { describeRecurrence } from '@common/recurrence';
import { formatForUser } from '@common/format-date';
import { snoozePresets } from '@common/fire-time';
import { getEnv } from '@common/config';

const QUOTE_MAX = 300;

@Injectable()
export class NotificationGatewayImpl implements NotificationGateway {
  constructor(private readonly botService: TelegramBotService) {}

  public async sendReminder(input: SendReminderInput): Promise<SentReminder> {
    const bot = this.botService.getBot();
    const now = new Date();

    try {
      const message = await bot.api.sendMessage(
        input.chatId,
        reminderText(input, now),
        {
          reply_markup: reminderKeyboard(input, now),
          parse_mode: 'HTML',
        },
      );
      return { messageId: message?.message_id ?? null };
    } catch (error) {
      // 400 (bad request, chat not found) and 403 (bot blocked, user
      // deactivated) fail the same way on every retry; anything else
      // (429, 5xx, network) may succeed on the next tick.
      const permanent =
        error instanceof GrammyError &&
        (error.error_code === 400 || error.error_code === 403);
      throw new NotificationFailedError(
        `Failed to send reminder for task ${input.taskId}`,
        error,
        { permanent },
      );
    }
  }

  public async sendDigest(digest: Digest): Promise<SentReminder> {
    const reply = presentDigest(digest);
    try {
      const message = await this.botService
        .getBot()
        .api.sendMessage(digest.chatId, reply.html, {
          parse_mode: 'HTML',
          ...(reply.keyboard ? { reply_markup: reply.keyboard } : {}),
        });
      return { messageId: message?.message_id ?? null };
    } catch (error) {
      const permanent =
        error instanceof GrammyError &&
        (error.error_code === 400 || error.error_code === 403);
      throw new NotificationFailedError(
        `Failed to send ${digest.kind}`,
        error,
        { permanent },
      );
    }
  }

  public async sendDocument(input: SendDocumentInput): Promise<void> {
    try {
      await this.botService
        .getBot()
        .api.sendDocument(
          input.chatId,
          new InputFile(Buffer.from(input.content, 'utf8'), input.filename),
          { caption: input.caption, parse_mode: 'HTML' },
        );
    } catch (error) {
      const permanent =
        error instanceof GrammyError &&
        (error.error_code === 400 || error.error_code === 403);
      throw new NotificationFailedError(
        `Failed to send ${input.filename}`,
        error,
        { permanent },
      );
    }
  }

  public async upsertPinnedAgenda(
    agenda: PinnedAgenda,
    messageId: number | null,
  ): Promise<SentReminder> {
    const api = this.botService.getBot().api;
    const html = presentPinnedAgenda(agenda);
    if (messageId !== null) {
      try {
        await api.editMessageText(agenda.chatId, messageId, html, {
          parse_mode: 'HTML',
        });
        return { messageId };
      } catch (error) {
        if (isNotModifiedError(error)) return { messageId };
        // The message was deleted (or can no longer be edited): a new one
        // takes its place below. Anything else is a real failure.
        if (!isMessageGoneError(error)) {
          throw new NotificationFailedError(
            'Failed to redraw the pinned agenda',
            error,
            { permanent: isPermanent(error) },
          );
        }
        await api
          .unpinChatMessage(agenda.chatId, messageId)
          .catch(() => undefined);
      }
    }
    try {
      const sent = await api.sendMessage(agenda.chatId, html, {
        parse_mode: 'HTML',
        disable_notification: true,
      });
      // Pinning needs no rights in a private chat, but a failed pin must
      // not lose the message: the next redraw edits it either way.
      await api
        .pinChatMessage(agenda.chatId, sent.message_id, {
          disable_notification: true,
        })
        .catch(() => undefined);
      return { messageId: sent.message_id };
    } catch (error) {
      throw new NotificationFailedError(
        'Failed to send the pinned agenda',
        error,
        { permanent: isPermanent(error) },
      );
    }
  }

  public async removePinnedAgenda(
    chatId: number,
    messageId: number,
  ): Promise<void> {
    const api = this.botService.getBot().api;
    // Best effort on both: the user may have unpinned or deleted it already.
    await api.unpinChatMessage(chatId, messageId).catch(() => undefined);
    await api.deleteMessage(chatId, messageId).catch(() => undefined);
  }

  public async sendSourceLink(
    input: SendSourceLinkInput,
  ): Promise<SentReminder> {
    try {
      const message = await this.botService
        .getBot()
        .api.sendMessage(
          input.chatId,
          `↑ This is where <b>${escapeHtml(input.description)}</b> came from.`,
          {
            parse_mode: 'HTML',
            // Fail instead of posting a reply to nothing.
            reply_parameters: {
              message_id: input.replyToMessageId,
              allow_sending_without_reply: false,
            },
          },
        );
      return { messageId: message?.message_id ?? null };
    } catch (error) {
      if (
        error instanceof GrammyError &&
        error.error_code === 400 &&
        /repl(y|ied).*not found/i.test(error.description)
      ) {
        throw new SourceMessageGoneError(
          `Source message ${input.replyToMessageId} is gone`,
          error,
        );
      }
      const permanent =
        error instanceof GrammyError &&
        (error.error_code === 400 || error.error_code === 403);
      throw new NotificationFailedError(
        'Failed to send the source link',
        error,
        { permanent },
      );
    }
  }
}

function isPermanent(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    (error.error_code === 400 || error.error_code === 403)
  );
}

/** "message to edit not found" / "message can't be edited": send a new one. */
function isMessageGoneError(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /message (to edit )?not found|can't be edited|MESSAGE_ID_INVALID/i.test(
      error.description,
    )
  );
}

export function reminderText(input: SendReminderInput, now: Date): string {
  const lines: string[] = [];
  if (input.kind === 'heads_up') {
    const minutes = Math.max(1, differenceInMinutes(input.dueAt, now));
    lines.push(`⏳ <b>In ${humanMinutes(minutes)}</b>`);
  } else if (input.kind === 'nudge') {
    const late = Math.max(1, differenceInMinutes(now, input.dueAt));
    lines.push(`🔁 <b>Still open</b> · ${humanMinutes(late)} since it was due`);
  } else {
    lines.push('🔔 <b>Reminder</b>');
  }
  lines.push('', `📝 ${escapeHtml(input.description)}`);
  lines.push(
    input.allDay
      ? `📅 ${formatForUser(input.dueAt, input.timezone, true)}`
      : `⏰ ${formatForUser(input.dueAt, input.timezone)}`,
  );
  const repeat = describeRecurrence(input.recurrence, input.timezone);
  if (repeat) lines.push(`🔁 Repeats ${repeat}`);
  if (input.notes) lines.push('', `🗒 ${escapeHtml(input.notes)}`);
  if (input.sourceQuote) {
    const text =
      input.sourceQuote.text.length > QUOTE_MAX
        ? `${input.sourceQuote.text.slice(0, QUOTE_MAX)}…`
        : input.sourceQuote.text;
    const from = input.sourceQuote.from
      ? `${escapeHtml(input.sourceQuote.from)}: `
      : '';
    lines.push('', `<blockquote>${from}${escapeHtml(text)}</blockquote>`);
  }
  if (input.kind !== 'heads_up') {
    lines.push(
      '',
      '<i>Reply with a time (“in 2 hours”, “tomorrow 9”) to snooze.</i>',
    );
  }
  return lines.join('\n');
}

/**
 * Done · +15m → 11:15 · +1h → 12:00 / Tonight 20:00 · Tomorrow 09:00 /
 * Open (when the Mini App URL is configured). Every snooze label shows the
 * resulting time so there is nothing to compute in your head.
 */
export function reminderKeyboard(
  input: Pick<SendReminderInput, 'taskId' | 'timezone' | 'kind' | 'dueAt'>,
  now: Date,
): InlineKeyboard {
  const clock = (d: Date): string =>
    formatInTimeZone(d, input.timezone, 'HH:mm');
  // The heads-up comes before the time: its Done names the occurrence, or
  // it would be taken for a stale tap on a series that is "already ahead".
  const keyboard = new InlineKeyboard().text(
    '✅ Done',
    input.kind === 'heads_up'
      ? `complete:${input.taskId}:${Math.floor(input.dueAt.getTime() / 1000)}`
      : `complete:${input.taskId}`,
  );

  if (input.kind !== 'heads_up') {
    keyboard
      .text(`+15m → ${clock(addMinutes(now, 15))}`, `delay:${input.taskId}:15`)
      .text(`+1h → ${clock(addMinutes(now, 60))}`, `delay:${input.taskId}:60`)
      .row();
    for (const preset of snoozePresets(now, input.timezone)) {
      keyboard.text(
        `${preset.label} ${clock(preset.at)}`,
        `snz:${input.taskId}:${preset.key}`,
      );
    }
  }

  const appUrl = getEnv().MINI_APP_URL;
  if (appUrl) {
    const url = new URL(appUrl);
    url.searchParams.set('task', input.taskId);
    keyboard.row().webApp('⋯ Open in app', url.toString());
  }
  return keyboard;
}

function humanMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
