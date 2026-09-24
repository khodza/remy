/**
 * The app wiring from main.ts on a small Nest app without MongoDB: pino as
 * the logger with request ids, the /api/v1 prefix, and the Telegram webhook
 * route that TelegramBotService registers on the Express instance during
 * init (outside the prefix, behind Nest's body parser). The full AppModule
 * version, with an in-memory MongoDB, is test/ops.e2e-spec.ts.
 */
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import type { Update, UserFromGetMe } from 'grammy/types';
import { configureApp } from './bootstrap';
import { getEnv } from '@common/config';
import { loggerParams } from '@application/common/logging/logger.options';
import {
  TelegramBotService,
  WEBHOOK_SECRET_HEADER,
} from '@infra/bot/bot.service';
import {
  CallbackHandler,
  CommandHandler,
  MessageHandler,
} from '@infra/bot/handlers';
import { HealthController } from '@application/common/http/controllers/health.controller';
import { HealthService } from '@application/common/http/services/health.service';

const SECRET = 'bootstrap-spec-secret-0123';

const helpUpdate: Update = {
  update_id: 7,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 12345, type: 'private', first_name: 'Test' },
    from: { id: 12345, is_bot: false, first_name: 'Test' },
    text: '/help',
    entities: [{ type: 'bot_command', offset: 0, length: 5 }],
  },
};

describe('configureApp', () => {
  let app: INestApplication | undefined;
  const handleHelp = jest.fn().mockResolvedValue(undefined);
  const apiCalls: string[] = [];

  async function boot(mode: 'polling' | 'webhook'): Promise<INestApplication> {
    process.env['BOT_MODE'] = mode;
    process.env['WEBHOOK_URL'] = 'https://remy.example.com/telegram/webhook';
    process.env['WEBHOOK_SECRET'] = SECRET;
    process.env['OWNER_TELEGRAM_ID'] = '12345';

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(loggerParams(getEnv()))],
      controllers: [HealthController],
      providers: [
        TelegramBotService,
        { provide: CommandHandler, useValue: { handleHelp } },
        { provide: MessageHandler, useValue: {} },
        { provide: CallbackHandler, useValue: {} },
        {
          provide: HealthService,
          useValue: { check: async () => ({ status: 'ok', checks: {} }) },
        },
      ],
    }).compile();

    // Keep grammY off the network; polling is never started for real.
    const bot = moduleRef.get(TelegramBotService).getBot();
    bot.api.config.use((_prev, method) => {
      apiCalls.push(method);
      const result =
        method === 'getMe'
          ? ({ id: 1, is_bot: true, first_name: 'Remy' } as UserFromGetMe)
          : true;
      return Promise.resolve({ ok: true, result: result as never });
    });
    jest
      .spyOn(
        TelegramBotService.prototype as unknown as { startPolling: () => void },
        'startPolling',
      )
      .mockImplementation(() => undefined);

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, getEnv());
    await app.init();
    return app;
  }

  beforeEach(() => {
    handleHelp.mockClear();
    apiCalls.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const key of [
      'BOT_MODE',
      'WEBHOOK_URL',
      'WEBHOOK_SECRET',
      'OWNER_TELEGRAM_ID',
    ]) {
      delete process.env[key];
    }
    jest.restoreAllMocks();
  });

  it('serves the API under /api/v1 with a request id on every response', async () => {
    const app = await boot('polling');
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'probe-1')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('probe-1');
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('polling mode: no webhook route, the leftover webhook is deleted', async () => {
    const app = await boot('polling');
    expect(apiCalls).toContain('deleteWebhook');
    expect(apiCalls).not.toContain('setWebhook');
    await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set(WEBHOOK_SECRET_HEADER, SECRET)
      .send(helpUpdate)
      .expect(404);
    expect(handleHelp).not.toHaveBeenCalled();
  });

  it('webhook mode: registers the webhook and handles updates outside /api/v1', async () => {
    const app = await boot('webhook');
    expect(apiCalls).toContain('setWebhook');
    expect(apiCalls).not.toContain('deleteWebhook');

    await request(app.getHttpServer())
      .post('/telegram/webhook')
      .send(helpUpdate)
      .expect(401);
    expect(handleHelp).not.toHaveBeenCalled();

    // Parsed by Nest's body parser: the update reaches the command handler.
    await request(app.getHttpServer())
      .post('/telegram/webhook')
      .set(WEBHOOK_SECRET_HEADER, SECRET)
      .send(helpUpdate)
      .expect(200);
    expect(handleHelp).toHaveBeenCalledTimes(1);

    // Not under the API prefix, and only POST.
    await request(app.getHttpServer())
      .post('/api/v1/telegram/webhook')
      .set(WEBHOOK_SECRET_HEADER, SECRET)
      .send(helpUpdate)
      .expect(404);
    await request(app.getHttpServer()).get('/telegram/webhook').expect(404);
  });
});
