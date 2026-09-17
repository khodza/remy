import { Bot, BotError } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { ModuleRef } from '@nestjs/core';
import { TelegramBotService } from './bot.service';

describe('TelegramBotService', () => {
  const originalToken = process.env['TELEGRAM_BOT_TOKEN'];

  const helpCommand: Update = {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 12345, type: 'private', first_name: 'Test' },
      from: { id: 12345, is_bot: false, first_name: 'Test' },
      text: '/help',
      entities: [{ type: 'bot_command', offset: 0, length: 5 }],
    },
  };

  beforeEach(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = '123456:TEST';
    jest.spyOn(Bot.prototype, 'start').mockResolvedValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env['TELEGRAM_BOT_TOKEN'];
    else process.env['TELEGRAM_BOT_TOKEN'] = originalToken;
    jest.restoreAllMocks();
  });

  it('should keep polling when a handler throws', async () => {
    const commandHandler = {
      handleHelp: jest.fn().mockRejectedValue(new Error('reply failed')),
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(commandHandler),
    } as unknown as ModuleRef;
    const service = new TelegramBotService(moduleRef);
    await service.onModuleInit();

    const bot = service.getBot();
    bot.botInfo = { id: 1, is_bot: true, username: 'remy_test_bot' } as UserFromGetMe;
    const stop = jest.spyOn(bot, 'stop');

    const botError: unknown = await bot.handleUpdate(helpCommand).catch((e: unknown) => e);
    expect(botError).toBeInstanceOf(BotError);
    expect(commandHandler.handleHelp).toHaveBeenCalled();

    // The polling loop hands handler errors to errorHandler; grammY's default
    // one stops the bot and rethrows, which would fail this test.
    await bot.errorHandler(botError as BotError);
    expect(stop).not.toHaveBeenCalled();
  });
});
