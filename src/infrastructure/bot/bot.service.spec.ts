import { Logger } from '@nestjs/common';
import { BotError } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { TelegramBotService, type WebhookHandler } from './bot.service';

describe('TelegramBotService', () => {
  const originalEnv = { ...process.env };
  const ENV_KEYS = [
    'TELEGRAM_BOT_TOKEN',
    'OWNER_TELEGRAM_ID',
    'BOT_MODE',
    'WEBHOOK_URL',
    'WEBHOOK_SECRET',
  ] as const;

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

  let startPolling: jest.SpyInstance;
  let expressPost: jest.Mock;

  beforeEach(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = '123456:TEST';
    // Never actually poll Telegram from a unit test.
    startPolling = jest
      .spyOn(
        TelegramBotService.prototype as unknown as { startPolling: () => void },
        'startPolling',
      )
      .mockImplementation(() => undefined);
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    expressPost = jest.fn();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = originalEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    jest.restoreAllMocks();
  });

  async function startService(commandHandler: { handleHelp: jest.Mock }) {
    const moduleRef = {
      get: jest.fn().mockReturnValue(commandHandler),
    } as unknown as ModuleRef;
    const httpAdapterHost = {
      httpAdapter: { getInstance: () => ({ post: expressPost }) },
    } as unknown as HttpAdapterHost;
    const service = new TelegramBotService(moduleRef, httpAdapterHost);
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

  describe('BOT_MODE', () => {
    it('polls by default, after removing any stale webhook', async () => {
      const { apiCalls } = await startService({ handleHelp: jest.fn() });
      expect(apiCalls.map((c) => c.method)).toContain('deleteWebhook');
      expect(apiCalls.map((c) => c.method)).not.toContain('setWebhook');
      expect(startPolling).toHaveBeenCalledTimes(1);
      expect(expressPost).not.toHaveBeenCalled();
    });

    it('still polls when deleteWebhook fails', async () => {
      const moduleRef = {
        get: jest.fn().mockReturnValue({ handleHelp: jest.fn() }),
      } as unknown as ModuleRef;
      const service = new TelegramBotService(moduleRef, {
        httpAdapter: { getInstance: () => ({ post: expressPost }) },
      } as unknown as HttpAdapterHost);
      service.getBot().api.config.use((_prev, method) => {
        if (method === 'deleteWebhook') {
          return Promise.reject(new Error('network down'));
        }
        return Promise.resolve({ ok: true, result: true as never });
      });
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(startPolling).toHaveBeenCalledTimes(1);
    });

    it('in webhook mode serves the URL path and registers it with Telegram', async () => {
      process.env['BOT_MODE'] = 'webhook';
      process.env['WEBHOOK_URL'] = 'https://remy.example.com/telegram/webhook';
      process.env['WEBHOOK_SECRET'] = 's3cret_token';

      const { apiCalls } = await startService({ handleHelp: jest.fn() });

      expect(startPolling).not.toHaveBeenCalled();
      expect(apiCalls.map((c) => c.method)).not.toContain('deleteWebhook');
      const setWebhook = apiCalls.find((c) => c.method === 'setWebhook');
      expect(setWebhook?.payload).toEqual({
        url: 'https://remy.example.com/telegram/webhook',
        secret_token: 's3cret_token',
      });
      expect(expressPost).toHaveBeenCalledWith(
        '/telegram/webhook',
        expect.any(Function),
      );
    });
  });

  describe('webhook handler', () => {
    const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

    function fakeRequest(update: Update, secret: string | undefined) {
      const headers: Record<string, string | undefined> = {
        [SECRET_HEADER.toLowerCase()]: secret,
      };
      type FakeResponse = {
        statusCode: number;
        status: jest.Mock<FakeResponse, [number]>;
        send: jest.Mock;
        set: jest.Mock;
        end: jest.Mock;
      };
      const res: FakeResponse = {
        statusCode: 200,
        status: jest.fn((code: number) => {
          res.statusCode = code;
          return res;
        }),
        send: jest.fn(),
        set: jest.fn(),
        end: jest.fn(),
      };
      const req = {
        body: update,
        header: (name: string) => headers[name.toLowerCase()],
      };
      return { req, res };
    }

    async function webhookService(commandHandler: { handleHelp: jest.Mock }) {
      process.env['BOT_MODE'] = 'webhook';
      process.env['WEBHOOK_URL'] = 'https://remy.example.com/telegram/webhook';
      process.env['WEBHOOK_SECRET'] = 's3cret_token';
      const started = await startService(commandHandler);
      const handler = expressPost.mock.calls[0]?.[1] as WebhookHandler;
      return { ...started, handler };
    }

    it('rejects a missing or wrong secret with 401 before running anything', async () => {
      const commandHandler = { handleHelp: jest.fn() };
      const { handler } = await webhookService(commandHandler);

      for (const secret of [undefined, 'wrong', 's3cret_token ']) {
        const { req, res } = fakeRequest(helpCommand, secret);
        await handler(req as never, res as never);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.send).toHaveBeenCalled();
      }
      expect(commandHandler.handleHelp).not.toHaveBeenCalled();
    });

    it('handles the update and answers 200 when the secret matches', async () => {
      process.env['OWNER_TELEGRAM_ID'] = '12345';
      const commandHandler = {
        handleHelp: jest.fn().mockResolvedValue(undefined),
      };
      const { handler } = await webhookService(commandHandler);

      const { req, res } = fakeRequest(helpCommand, 's3cret_token');
      await handler(req as never, res as never);

      expect(commandHandler.handleHelp).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalled();
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
