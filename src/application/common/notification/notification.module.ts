import { Module } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { NotificationGatewayImpl } from '@infra/bot/notification/gateway';
import { TelegramBotService } from '@infra/bot/bot.service';

/**
 * NotificationModule provides Telegram bot infrastructure
 * TelegramBotService uses lazy injection via ModuleRef to get handlers
 * This avoids circular dependency with BotModule
 */
@Module({
  imports: [],
  providers: [
    TelegramBotService,
    {
      provide: Domain.Notification.Gateway,
      useClass: NotificationGatewayImpl,
    },
  ],
  exports: [TelegramBotService, Domain.Notification.Gateway],
})
export class NotificationModule {}
