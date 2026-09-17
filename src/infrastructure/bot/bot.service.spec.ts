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
    delete process.env['OWNER_TELEGRAM_ID'];
    jest.restoreAllMocks();
  });

  async function startService(commandHandler: { handleHelp: jest.Mock }) {
    const moduleRef = {
      get: jest.fn().mockReturnValue(commandHandler),
    } as unknown as ModuleRef;
    const service = new TelegramBotService(moduleRef);
    const bot = service.getBot();
    // Keep unit tests off the network: a transformer on bot.api also
    // covers the per-update ctx.api that ctx.reply() uses.
    const apiCalls: Array<{ method: string; payload: unknown }> = [];
    bot.api.config.use((_prev, method, payload) => {
      apiCalls.push({ method, payload });
      return Promise.resolve({ ok: true, result: true as never });
    });
    await service.onModuleInit();
    bot.botInfo = {
      id: 1,
      is_bot: true,
      username: 'remy_test_bot',
    } as UserFromGetMe;
    return { service, bot, apiCalls };
  }

  it('registers the command menu at startup', async () => {
    const { apiCalls } = await startService({ handleHelp: jest.fn() });
    const call = apiCalls.find((c) => c.method === 'setMyCommands');
    expect(call?.payload).toEqual({
      commands: expect.arrayContaining([
        expect.objectContaining({ command: 'list' }),
        expect.objectContaining({ command: 'help' }),
      ]),
    });
  });

  describe('owner lock', () => {
    it('ignores updates from other users and replies once', async () => {
      process.env['OWNER_TELEGRAM_ID'] = '999';
      const commandHandler = { handleHelp: jest.fn() };
      const { bot, apiCalls } = await startService(commandHandler);

      await bot.handleUpdate(helpCommand); // from user 12345
      expect(commandHandler.handleHelp).not.toHaveBeenCalled();
      const reply = apiCalls.find((c) => c.method === 'sendMessage');
      expect(reply?.payload).toEqual(
        expect.objectContaining({
          chat_id: 12345,
          text: expect.stringContaining('private bot'),
        }),
      );
    });

    it('serves the owner', async () => {
      process.env['OWNER_TELEGRAM_ID'] = '12345';
      const commandHandler = {
        handleHelp: jest.fn().mockResolvedValue(undefined),
      };
      const { bot } = await startService(commandHandler);

      await bot.handleUpdate(helpCommand);
      expect(commandHandler.handleHelp).toHaveBeenCalled();
    });
  });

  it('should keep polling when a handler throws', async () => {
    const commandHandler = {
      handleHelp: jest.fn().mockRejectedValue(new Error('reply failed')),
    };
    const { bot } = await startService(commandHandler);
    const stop = jest.spyOn(bot, 'stop');

    const botError: unknown = await bot
      .handleUpdate(helpCommand)
      .catch((e: unknown) => e);
    expect(botError).toBeInstanceOf(BotError);
    expect(commandHandler.handleHelp).toHaveBeenCalled();

    // The polling loop hands handler errors to errorHandler; grammY's default
    // one stops the bot and rethrows, which would fail this test.
    await bot.errorHandler(botError as BotError);
    expect(stop).not.toHaveBeenCalled();
  });
});
