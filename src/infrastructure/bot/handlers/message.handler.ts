import { Injectable } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import type { Message, MessageOrigin } from 'grammy/types';
import { formatInTimeZone } from 'date-fns-tz';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import {
  HandleMessageUsecase,
  TranscribeAudioUsecase,
} from '@usecases/assistant';
import { snoozePresets } from '@common/fire-time';
import { getEnv } from '@common/config';
import { AssistantResponder } from '../assistant.responder';
import { resolveTimezone, toEnsureUserInput } from '../user-input';

/** Telegram's own bot-API download limit. */
const VOICE_MAX_BYTES = 20 * 1024 * 1024;

@Injectable()
export class MessageHandler {
  constructor(
    private readonly ensureUserUsecase: EnsureUserUsecase,
    private readonly handleMessage: HandleMessageUsecase,
    private readonly transcribeAudio: TranscribeAudioUsecase,
    private readonly responder: AssistantResponder,
  ) {}

  public async handleText(ctx: Context): Promise<void> {
    const message = ctx.message;
    const text = message?.text;
    if (!message || text === undefined || ctx.from === undefined) return;
    if (text.startsWith('/')) return; // commands have their own handler

    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    await this.responder.respond(ctx, user, text, {
      source: { type: 'text', messageId: message.message_id },
      ...replyContext(message, ctx.me.id),
    });
  }

  /**
   * A forwarded message (text, or media with a caption) on its own carries
   * no instruction. Keep it and ask when; the answer, typed or tapped, goes
   * through the assistant with the forward as the quoted context.
   */
  public async handleForward(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message || ctx.from === undefined || !message.forward_origin) return;
    const content = message.text ?? message.caption ?? '';
    if (content.trim() === '') {
      await ctx.reply(
        '📎 I can only remember forwarded messages that contain text. Reply to it with what I should remind you about.',
      );
      return;
    }

    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    const chatId = ctx.chat?.id ?? ctx.from.id;
    await this.handleMessage.captureForward({
      chatId,
      text: content,
      forwardedFrom: originName(message.forward_origin),
      messageId: message.message_id,
    });

    const timezone = resolveTimezone(user);
    const keyboard = new InlineKeyboard();
    for (const preset of snoozePresets(new Date(), timezone)) {
      keyboard.text(
        `${preset.label} ${formatInTimeZone(preset.at, timezone, 'HH:mm')}`,
        `fwd:${preset.key}`,
      );
    }
    keyboard.row().text('📥 Just save it (no date)', 'fwd:inbox');

    await ctx.reply(
      '📌 Got it. <b>When should I remind you about this?</b>\nTap a time or just tell me (“Friday morning”, “in 3 hours”).',
      {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        reply_parameters: { message_id: message.message_id },
      },
    );
  }

  public async handleVoice(ctx: Context): Promise<void> {
    const message = ctx.message;
    const voice = message?.voice;
    if (!message || voice === undefined || ctx.from === undefined) return;

    if (voice.file_size !== undefined && voice.file_size > VOICE_MAX_BYTES) {
      await ctx.reply('❌ That voice message is too large (max 20 MB).');
      return;
    }

    let transcript: string;
    try {
      await ctx.replyWithChatAction('typing').catch(() => undefined);
      const audio = await downloadVoice(ctx);
      ({ text: transcript } = await this.transcribeAudio.execute({
        audio,
        mimeType: voice.mime_type ?? 'audio/ogg',
      }));
    } catch (error) {
      console.error('Failed to transcribe voice message:', error);
      await ctx.reply(
        '❌ I could not make out that voice message. Please try again, a little closer to the mic.',
      );
      return;
    }

    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    await this.responder.respond(ctx, user, transcript, {
      source: { type: 'voice', messageId: message.message_id },
      transcript,
      ...replyContext(message, ctx.me.id),
    });
  }
}

/**
 * What the message replies to. A reply to one of Remy's messages points at
 * tasks (resolved later through the message link); a reply to anything else
 * quotes that message as the thing to be reminded about.
 */
function replyContext(
  message: Message,
  botId: number,
): {
  replyToMessageId?: number;
  quoted?: { text: string; from: string | null };
} {
  const target = message.reply_to_message;
  if (!target) return {};
  if (target.from?.id === botId) return { replyToMessageId: target.message_id };
  const text = target.text ?? target.caption ?? '';
  if (text.trim() === '') return {};
  return {
    quoted: {
      text,
      from: target.forward_origin
        ? originName(target.forward_origin)
        : (target.from?.first_name ?? null),
    },
  };
}

function originName(origin: MessageOrigin): string | null {
  switch (origin.type) {
    case 'user':
      return [origin.sender_user.first_name, origin.sender_user.last_name]
        .filter(Boolean)
        .join(' ');
    case 'hidden_user':
      return origin.sender_user_name;
    case 'chat':
      return origin.sender_chat.title ?? null;
    case 'channel':
      return origin.chat.title ?? null;
  }
}

async function downloadVoice(ctx: Context): Promise<Buffer> {
  const file = await ctx.getFile();
  if (!file.file_path) {
    throw new Error('Telegram returned no file_path for the voice message');
  }
  const response = await fetch(
    `https://api.telegram.org/file/bot${getEnv().TELEGRAM_BOT_TOKEN}/${file.file_path}`,
  );
  if (!response.ok) {
    throw new Error(
      `Voice download failed: ${response.status} ${response.statusText}`,
    );
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0)
    throw new Error('Voice download returned an empty body');
  return audio;
}
