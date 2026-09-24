/**
 * Operations e2e: the real AppModule, wired by configureApp exactly like
 * main.ts, in BOT_MODE=webhook against an in-memory MongoDB. Telegram is
 * stubbed at the grammY API layer (no network). Covers the webhook route
 * and /health (Mongo ping + cached getMe, 503 when Mongo is gone).
 *
 *   npm run test:e2e
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { Update, UserFromGetMe } from 'grammy/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { getEnv } from '@common/config';
import { Domain } from '@common/tokens';
import {
  TelegramBotService,
  WEBHOOK_SECRET_HEADER,
} from '@infra/bot/bot.service';

const OWNER_ID = 4242;
const STRANGER_ID = 12345;
const SECRET = 'ops-e2e-webhook-secret-0123';
const WEBHOOK_URL = 'https://remy.example.test/telegram/webhook';

describe('Remy ops (e2e, webhook mode)', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> =
    [];

  const strangerHelp: Update = {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: STRANGER_ID, type: 'private', first_name: 'Eve' },
      from: { id: STRANGER_ID, is_bot: false, first_name: 'Eve' },
      text: '/help',
      entities: [{ type: 'bot_command', offset: 0, length: 5 }],
    },
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env['MONGODB_URI'] = mongod.getUri();
    process.env['OWNER_TELEGRAM_ID'] = String(OWNER_ID);
    process.env['BOT_MODE'] = 'webhook';
    process.env['WEBHOOK_URL'] = WEBHOOK_URL;
    process.env['WEBHOOK_SECRET'] = SECRET;
    process.env['CORS_ORIGINS'] = '';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Domain.Assistant.InterpreterGateway)
      .useValue({ interpret: jest.fn() })
      .compile();

    // The real TelegramBotService, with grammY's API answered locally.
    moduleRef
      .get(TelegramBotService)
      .getBot()
      .api.config.use((_prev, method, payload) => {
        apiCalls.push({
          method,
          payload: payload as unknown as Record<string, unknown>,
        });
        const result =
          method === 'getMe'
            ? ({
                id: 1,
                is_bot: true,
                first_name: 'Remy',
                username: 'remy_e2e_bot',
              } as UserFromGetMe)
            : method === 'sendMessage'
              ? { message_id: 1, date: 0, chat: { id: STRANGER_ID } }
              : true;
        return Promise.resolve({ ok: true, result: result as never });
      });

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, getEnv());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
    for (const key of [
      'BOT_MODE',
      'WEBHOOK_URL',
      'WEBHOOK_SECRET',
      'OWNER_TELEGRAM_ID',
    ]) {
      delete process.env[key];
    }
  });

  const http = () => request(app.getHttpServer());

  it('registers the webhook with its secret on boot and does not poll', () => {
    const setWebhook = apiCalls.find((c) => c.method === 'setWebhook');
    expect(setWebhook?.payload).toMatchObject({
      url: WEBHOOK_URL,
      secret_token: SECRET,
    });
    expect(apiCalls.some((c) => c.method === 'deleteWebhook')).toBe(false);
    expect(apiCalls.some((c) => c.method === 'getUpdates')).toBe(false);
  });

  it('health: 200 with Mongo and Telegram up, getMe cached, request id echoed', async () => {
    const res = await http()
      .get('/api/v1/health')
      .set('x-request-id', 'e2e-health-1')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('e2e-health-1');
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: {
        mongo: { status: 'up' },
        telegram: { status: 'up' },
      },
    });

    await http().get('/api/v1/health').expect(200);
    expect(apiCalls.filter((c) => c.method === 'getMe')).toHaveLength(1);
  });

  it('webhook: 401 without the secret header, nothing handled', async () => {
    const before = apiCalls.length;
    await http().post('/telegram/webhook').send(strangerHelp).expect(401);
    await http()
      .post('/telegram/webhook')
      .set(WEBHOOK_SECRET_HEADER, 'not-the-secret-0123456789')
      .send(strangerHelp)
      .expect(401);
    expect(apiCalls.length).toBe(before);
  });

  it('webhook: handles an update with the secret (owner lock answers a stranger)', async () => {
    await http()
      .post('/telegram/webhook')
      .set(WEBHOOK_SECRET_HEADER, SECRET)
      .send(strangerHelp)
      .expect(200);
    const reply = apiCalls.find((c) => c.method === 'sendMessage');
    expect(reply?.payload).toMatchObject({
      chat_id: STRANGER_ID,
      text: expect.stringContaining('private bot'),
    });
  });

  it('webhook route is outside /api/v1', async () => {
    await http()
      .post('/api/v1/telegram/webhook')
      .set(WEBHOOK_SECRET_HEADER, SECRET)
      .send(strangerHelp)
      .expect(404);
  });

  // Last: it closes the Mongo connection.
  it('health: 503 with the failing check when MongoDB is gone', async () => {
    await app.get<Connection>(getConnectionToken()).close();
    const res = await http().get('/api/v1/health').expect(503);
    expect(res.body).toMatchObject({
      status: 'error',
      checks: { mongo: { status: 'down' }, telegram: { status: 'up' } },
    });
  });
});
