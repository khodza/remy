import { Injectable } from '@nestjs/common';
import { Context } from 'grammy';
import type { Recurrence } from '@domain/task';
import {
  ProcessTextMessageUsecase,
  type ProcessTextMessageOutput,
} from '@usecases/task/process-text-message';
import {
  ProcessVoiceMessageUsecase,
  type ProcessVoiceMessageOutput,
} from '@usecases/task/process-voice-message';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { escapeHtml } from '../html';
import { describeRecurrence } from '@common/recurrence';
import { formatForUser } from '@common/format-date';
import { getEnv } from '@common/config';
import { resolveTimezone, toEnsureUserInput } from '../user-input';

/** Telegram's own bot-API download limit. */
const VOICE_MAX_BYTES = 20 * 1024 * 1024;

@Injectable()
export class MessageHandler {
  constructor(
    private readonly processTextMessageUsecase: ProcessTextMessageUsecase,
    private readonly processVoiceMessageUsecase: ProcessVoiceMessageUsecase,
    private readonly ensureUserUsecase: EnsureUserUsecase,
  ) {}

  public async handleText(ctx: Context): Promise<void> {
    const text = ctx.message?.text;
    if (text === undefined || ctx.from === undefined) return;

    // Skip command messages (they're handled by command handler)
    if (text.startsWith('/')) return;

    let result: ProcessTextMessageOutput;
    try {
      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );

      result = await this.processTextMessageUsecase.execute({
        userId: user.id,
        telegramChatId: ctx.chat?.id ?? ctx.from.id,
        text: text,
        userTimezone: resolveTimezone(user),
        source: {
          type: 'text',
          ...(ctx.message?.message_id !== undefined
            ? { messageId: ctx.message.message_id }
            : {}),
        },
      });
    } catch (error) {
      console.error('Failed to process text message:', error);
      await ctx.reply(
        '❌ Failed to create task. Please try again or use a different format.',
      );
      return;
    }

    // Kept outside the try: the task is already saved, so a failed
    // confirmation must not tell the user to retry (that duplicates it).
    await ctx.reply(
      `✅ <b>Task created!</b>\n\n📝 ${escapeHtml(result.description)}\n⏰ ${formatForUser(result.scheduledAt, result.timezone)}${recurrenceLine(result.recurrence)}`,
      { parse_mode: 'HTML' },
    );
  }

  public async handleVoice(ctx: Context): Promise<void> {
    const voice = ctx.message?.voice;
    if (voice === undefined || ctx.from === undefined) return;

    if (voice.file_size !== undefined && voice.file_size > VOICE_MAX_BYTES) {
      await ctx.reply('❌ That voice message is too large (max 20 MB).');
      return;
    }

    let result: ProcessVoiceMessageOutput;
    try {
      await ctx.reply('🎤 Processing your voice message...');

      const file = await ctx.getFile();
      if (!file.file_path) {
        throw new Error('Telegram returned no file_path for the voice message');
      }
      const token = getEnv().TELEGRAM_BOT_TOKEN;

      const response = await fetch(
        `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      );
      if (!response.ok) {
        throw new Error(
          `Voice download failed: ${response.status} ${response.statusText}`,
        );
      }
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      if (audioBuffer.byteLength === 0) {
        throw new Error('Voice download returned an empty body');
      }

      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );

      result = await this.processVoiceMessageUsecase.execute({
        userId: user.id,
        telegramChatId: ctx.chat?.id ?? ctx.from.id,
        audioFileBuffer: audioBuffer,
        mimeType: voice.mime_type ?? 'audio/ogg',
        userTimezone: resolveTimezone(user),
        sourceType: 'voice',
        ...(ctx.message?.message_id !== undefined
          ? { messageId: ctx.message.message_id }
          : {}),
      });
    } catch (error) {
      console.error('Failed to process voice message:', error);
      await ctx.reply(
        '❌ Failed to process voice message. Please try again with a clearer message.',
      );
      return;
    }

    await ctx.reply(
      `✅ <b>Task created from voice!</b>\n\n🎤 Transcribed: "${escapeHtml(result.transcribedText)}"\n📝 ${escapeHtml(result.description)}\n⏰ ${formatForUser(result.scheduledAt, result.timezone)}${recurrenceLine(result.recurrence)}`,
      { parse_mode: 'HTML' },
    );
  }
}

function recurrenceLine(recurrence: Recurrence | null): string {
  const label = describeRecurrence(recurrence);
  return label ? `\n🔁 Repeats ${label}` : '';
}
