import { Injectable } from '@nestjs/common';
import { GrammyError, InlineKeyboard } from 'grammy';
import { NotificationGateway } from '@domain/notification/gateway';
import { SendReminderInput } from '@domain/notification/gateway/types';
import { NotificationFailedError } from '@domain/notification/errors';
import { TelegramBotService } from '../bot.service';
import { escapeHtml } from '../html';
import { format } from 'date-fns';
import { describeRecurrence } from '@common/recurrence';

@Injectable()
export class NotificationGatewayImpl implements NotificationGateway {
  constructor(private readonly botService: TelegramBotService) {}

  public async sendReminder(input: SendReminderInput): Promise<void> {
    const bot = this.botService.getBot();

    const keyboard = new InlineKeyboard()
      .text('✅ Done', `complete:${input.taskId}`)
      .text('⏰ +15min', `delay:${input.taskId}:15`)
      .row()
      .text('⏰ +1hr', `delay:${input.taskId}:60`);

    const repeat = describeRecurrence(input.recurrence);
    const repeatLine = repeat ? `\n🔁 Repeats ${repeat}` : '';

    try {
      await bot.api.sendMessage(
        input.chatId,
        `🔔 <b>Reminder!</b>\n\n📝 ${escapeHtml(input.description)}\n⏰ Scheduled: ${format(input.scheduledAt, 'PPpp')}${repeatLine}`,
        { reply_markup: keyboard, parse_mode: 'HTML' },
      );
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
}
