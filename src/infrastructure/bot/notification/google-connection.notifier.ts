import { Injectable } from '@nestjs/common';
import type { GoogleConnectionNotifier } from '@domain/integrations/google-calendar';
import { TelegramBotService } from '../bot.service';
import { escapeHtml } from '../html';

/** "Connected": one line in the chat after the OAuth callback. Best effort. */
@Injectable()
export class GoogleConnectionNotifierImpl implements GoogleConnectionNotifier {
  constructor(private readonly botService: TelegramBotService) {}

  public async connected(input: {
    chatId: number;
    email: string | null;
  }): Promise<void> {
    const who = input.email ? ` <b>${escapeHtml(input.email)}</b>` : '';
    try {
      await this.botService
        .getBot()
        .api.sendMessage(
          input.chatId,
          `📅 Google Calendar${who} is connected. Your morning brief and /today now list the day's events. /connect to pick calendars or disconnect.`,
          { parse_mode: 'HTML' },
        );
    } catch (error) {
      console.error('Failed to confirm the Google connection in chat:', error);
    }
  }
}
