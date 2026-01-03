import { Injectable } from '@nestjs/common';
import { Context } from 'grammy';
import { ProcessTextMessageUsecase } from '@usecases/task/process-text-message';
import { ProcessVoiceMessageUsecase } from '@usecases/task/process-voice-message';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { format } from 'date-fns';

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

    try {
      // Ensure user exists
      const user = await this.ensureUserUsecase.execute({
        telegramUserId: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      });

      // Process message
      const result = await this.processTextMessageUsecase.execute({
        userId: user.id,
        telegramChatId: ctx.chat?.id ?? ctx.from.id,
        text: text,
        userTimezone: user.timezone ?? undefined,
      });

      await ctx.reply(
        `✅ *Task created!*\n\n📝 ${result.description}\n⏰ ${format(result.scheduledAt, 'PPpp')}`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      console.error('Failed to process text message:', error);
      await ctx.reply(
        '❌ Failed to create task. Please try again or use a different format.',
      );
    }
  }

  public async handleVoice(ctx: Context): Promise<void> {
    const voice = ctx.message?.voice;
    if (voice === undefined || ctx.from === undefined) return;

    try {
      await ctx.reply('🎤 Processing your voice message...');

      // Download voice file
      const file = await ctx.getFile();
      const token = process.env['TELEGRAM_BOT_TOKEN'];
      if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN is not defined');
      }

      const response = await fetch(
        `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      );
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      // Ensure user exists
      const user = await this.ensureUserUsecase.execute({
        telegramUserId: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      });

      // Process voice message
      const result = await this.processVoiceMessageUsecase.execute({
        userId: user.id,
        telegramChatId: ctx.chat?.id ?? ctx.from.id,
        audioFileBuffer: audioBuffer,
        mimeType: voice.mime_type ?? 'audio/ogg',
        userTimezone: user.timezone ?? undefined,
      });

      await ctx.reply(
        `✅ *Task created from voice!*\n\n🎤 Transcribed: "${result.transcribedText}"\n📝 ${result.description}\n⏰ ${format(result.scheduledAt, 'PPpp')}`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      console.error('Failed to process voice message:', error);
      await ctx.reply(
        '❌ Failed to process voice message. Please try again with a clearer message.',
      );
    }
  }
}
