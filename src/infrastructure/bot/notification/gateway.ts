import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { NotificationGateway } from '@domain/notification/gateway';
import { SendReminderInput } from '@domain/notification/gateway/types';
import { TelegramBotService } from '../bot.service';
import { format } from 'date-fns';

@Injectable()
export class NotificationGatewayImpl implements NotificationGateway {
  constructor(private readonly botService: TelegramBotService) {}

  public async sendReminder(input: SendReminderInput): Promise<void> {
    const bot = this.botService.getBot();

    const keyboard = new InlineKeyboard()
      .text('✅ Complete', `complete:${input.taskId}`)
      .text('⏰ +15min', `delay:${input.taskId}:15`)
      .row()
      .text('⏰ +1hr', `delay:${input.taskId}:60`);

    await bot.api.sendMessage(
      input.chatId,
      `🔔 *Reminder!*\n\n📝 ${input.description}\n⏰ Scheduled: ${format(input.scheduledAt, 'PPpp')}`,
      { reply_markup: keyboard, parse_mode: 'Markdown' },
    );
  }
}
