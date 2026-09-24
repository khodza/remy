/**
 * Google Calendar over HTTP: the real AppModule and the real Google client,
 * with only the transport (fetch) and Telegram faked. Env is flipped at
 * runtime (getEnv() re-reads process.env under NODE_ENV=test).
 *
 *   npm run test:e2e
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { formatInTimeZone } from 'date-fns-tz';
import { AppModule } from '../src/app.module';
import { TelegramBotService } from '@infra/bot/bot.service';
import {
  GoogleCalendarGatewayImpl,
  googleConfigFromEnv,
  type FetchLike,
} from '@infra/google/google-calendar.client';
import { presentBrief } from '@infra/bot/presenters/rhythm.presenter';
import { DigestBuilder } from '@usecases/rhythm';
import { Domain } from '@common/tokens';
import type { ConnectStateSigner } from '@domain/integrations/google-calendar';
import type { UserRepository } from '@domain/user';
import {
  ErrorBody,
  GoogleConnectResult,
  GoogleStatus,
  wire,
} from '@contract/remy-contract';

const MOCK_TG_ID = 123456789;
const TZ = 'Asia/Tashkent'; // UTC+5, no DST
const REDIRECT = 'https://remy.example.com/api/v1/integrations/google/callback';

describe('Google Calendar (e2e)', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let token: string;
  const sendMessage = jest.fn(
    async (_chatId: number, _text: string, _other?: unknown) => ({
      message_id: 1,
    }),
  );

  /** Every request the client makes, for assertions. */
  const googleCalls: { url: string; form: Record<string, string> }[] = [];
  const today = () => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
  const json = (status: number, body: unknown) => ({
    ok: status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
  const fakeFetch: FetchLike = async (url, init) => {
    const form = Object.fromEntries(
      new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    );
    googleCalls.push({ url, form });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (form['grant_type'] === 'refresh_token') {
        return json(200, { access_token: 'at-2', expires_in: 3600 });
      }
      if (form['code'] !== 'good-code') {
        return json(400, {
          error: 'invalid_grant',
          error_description: 'Bad Request',
        });
      }
      return json(200, {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
      });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      return json(200, {});
    }
    if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
      return json(200, { email: 'owner@example.com' });
    }
    if (url.includes('/users/me/calendarList')) {
      return json(200, {
        items: [
          { id: 'owner@example.com', summary: 'Owner', primary: true },
          { id: 'family@group.calendar.google.com', summary: 'Family' },
        ],
      });
    }
    if (
      url.includes('/calendars/primary/events') ||
      url.includes('/calendars/owner%40example.com/events')
    ) {
      return json(200, {
        items: [
          {
            id: 'standup',
            summary: 'Standup',
            start: { dateTime: `${today()}T09:30:00+05:00` },
            end: { dateTime: `${today()}T09:45:00+05:00` },
          },
          {
            id: 'gone',
            summary: 'Cancelled thing',
            status: 'cancelled',
            start: { dateTime: `${today()}T11:00:00+05:00` },
            end: { dateTime: `${today()}T12:00:00+05:00` },
          },
          {
            id: 'holiday',
            summary: 'Holiday',
            start: { date: today() },
            end: { date: today() },
          },
        ],
      });
    }
    if (url.includes('/calendars/family%40group.calendar.google.com/events')) {
      return json(200, {
        items: [
          {
            id: 'dinner',
            summary: 'Dinner',
            start: { dateTime: `${today()}T19:00:00+05:00` },
            end: { dateTime: `${today()}T21:00:00+05:00` },
          },
        ],
      });
    }
    return json(404, { error: { message: `unexpected ${url}` } });
  };

  const api = () => request(app.getHttpServer());
  const authed = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const status = async () =>
    GoogleStatus.parse(
      (
        await authed(api().get('/api/v1/integrations/google/status')).expect(
          200,
        )
      ).body,
    );
  const setGoogleEnv = (on: boolean) => {
    if (on) {
      process.env['GOOGLE_CLIENT_ID'] = 'id.apps.googleusercontent.com';
      process.env['GOOGLE_CLIENT_SECRET'] = 'shh';
      process.env['GOOGLE_REDIRECT_URL'] = REDIRECT;
    } else {
      delete process.env['GOOGLE_CLIENT_ID'];
      delete process.env['GOOGLE_CLIENT_SECRET'];
      delete process.env['GOOGLE_REDIRECT_URL'];
    }
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env['MONGODB_URI'] = mongod.getUri();
    process.env['DEV_ALLOW_MOCK_INITDATA'] = 'true';
    process.env['OWNER_TELEGRAM_ID'] = String(MOCK_TG_ID);
    process.env['OWNER_TIMEZONE'] = TZ;
    process.env['CORS_ORIGINS'] = '';
    setGoogleEnv(false);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramBotService)
      .useValue({ getBot: () => ({ api: { sendMessage } }) })
      .overrideProvider(Domain.Integrations.GoogleCalendarGateway)
      .useValue(new GoogleCalendarGatewayImpl(googleConfigFromEnv, fakeFetch))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    const initData = `auth_date=${Math.floor(Date.now() / 1000)}&user=${encodeURIComponent(
      JSON.stringify({ id: MOCK_TG_ID, first_name: 'Dev' }),
    )}&signature=x&hash=dev-mock-hash`;
    const res = await api()
      .post('/api/v1/auth/telegram')
      .set('Authorization', `tma ${initData}`)
      .expect(201);
    token = wire.AuthResult.parse(res.body).token;
  });

  afterAll(async () => {
    setGoogleEnv(false);
    await app?.close();
    await mongod?.stop();
  });

  it('without the env: status says not configured, connect is 409, the callback explains', async () => {
    expect(await status()).toEqual({ configured: false, connected: false });
    const res = await authed(
      api().post('/api/v1/integrations/google/connect'),
    ).expect(409);
    expect(ErrorBody.parse(res.body).message).toContain('not configured');
    const cb = await api()
      .get('/api/v1/integrations/google/callback?code=x&state=y')
      .expect(409);
    expect(cb.headers['content-type']).toContain('text/html');
    await api().get('/api/v1/integrations/google/status').expect(401);
  });

  it('connect → consent URL with a signed state; callback stores the tokens encrypted and tells the chat', async () => {
    setGoogleEnv(true);
    expect(await status()).toEqual({ configured: true, connected: false });

    const { url } = GoogleConnectResult.parse(
      (
        await authed(api().post('/api/v1/integrations/google/connect')).expect(
          201,
        )
      ).body,
    );
    const consent = new URL(url);
    expect(consent.origin).toBe('https://accounts.google.com');
    expect(consent.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(consent.searchParams.get('scope')).toContain('calendar.readonly');
    const state = consent.searchParams.get('state');
    expect(state).toBeTruthy();

    // A forged state, a cancelled consent and a bad code never connect.
    await api()
      .get('/api/v1/integrations/google/callback?code=good-code&state=forged')
      .expect(400);
    await api()
      .get('/api/v1/integrations/google/callback?error=access_denied')
      .expect(400);
    const badCode = await api()
      .get(
        `/api/v1/integrations/google/callback?code=bad&state=${encodeURIComponent(state!)}`,
      )
      .expect(502);
    expect(badCode.text).toContain('invalid_grant');
    expect(await status()).toMatchObject({ connected: false });

    sendMessage.mockClear();
    const ok = await api()
      .get(
        `/api/v1/integrations/google/callback?code=good-code&state=${encodeURIComponent(state!)}`,
      )
      .expect(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.text).toContain('Connected');
    expect(ok.text).toContain('owner@example.com');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toBe(MOCK_TG_ID);
    expect(String(sendMessage.mock.calls[0]?.[1])).toContain('connected');

    // At rest: sealed tokens, no plaintext anywhere in the document.
    const conn = app.get<Connection>(getConnectionToken());
    const doc = await conn.db!.collection('google_connections').findOne({});
    expect(doc).toBeTruthy();
    expect(JSON.stringify(doc)).not.toContain('rt-1');
    expect(JSON.stringify(doc)).not.toContain('at-1');
    expect(doc?.['refresh_token_enc']).toMatch(/^v1\./);
    expect(doc?.['email']).toBe('owner@example.com');
  });

  it('status lists the calendars with the primary selected; PATCH picks others; unknown ids are 400', async () => {
    expect(await status()).toEqual({
      configured: true,
      connected: true,
      email: 'owner@example.com',
      calendars: [
        { id: 'owner@example.com', summary: 'Owner', selected: true },
        {
          id: 'family@group.calendar.google.com',
          summary: 'Family',
          selected: false,
        },
      ],
    });

    await authed(api().patch('/api/v1/integrations/google'))
      .send({ calendarIds: ['nope'] })
      .expect(400);
    await authed(api().patch('/api/v1/integrations/google'))
      .send({ calendarIds: ['x'], extra: 1 })
      .expect(400);
    const picked = GoogleStatus.parse(
      (
        await authed(api().patch('/api/v1/integrations/google'))
          .send({ calendarIds: ['family@group.calendar.google.com'] })
          .expect(200)
      ).body,
    );
    expect(picked.calendars?.map((c) => c.selected)).toEqual([false, true]);
    // Back to both for the brief below.
    await authed(api().patch('/api/v1/integrations/google'))
      .send({
        calendarIds: ['owner@example.com', 'family@group.calendar.google.com'],
      })
      .expect(200);
  });

  it("the morning brief / today lists the day's events from the selected calendars", async () => {
    const users = app.get<UserRepository>(Domain.User.Repository);
    const user = await users.findByTelegramUserId(MOCK_TG_ID);
    expect(user).toBeTruthy();
    const brief = await app
      .get(DigestBuilder)
      .buildBrief(user!, TZ, new Date(), false);
    // Both calendars, all-day first, the cancelled one dropped.
    expect(brief.calendarEvents?.map((e) => e.title)).toEqual([
      'Holiday',
      'Standup',
      'Dinner',
    ]);
    const html = presentBrief(brief).html;
    expect(html).toContain('📅 <b>Calendar</b> · 3');
    expect(html).toContain('<b>All day</b> Holiday');
    expect(html).toContain('<b>09:30–09:45</b> Standup');
    expect(html).toContain('<b>19:00–21:00</b> Dinner');

    // With no selection Google's "primary" alias is used: the main calendar only.
    await authed(api().patch('/api/v1/integrations/google'))
      .send({ calendarIds: [] })
      .expect(200);
    const again = await app
      .get(DigestBuilder)
      .buildBrief(user!, TZ, new Date(), true);
    expect(again.calendarEvents?.map((e) => e.title)).toEqual([
      'Holiday',
      'Standup',
    ]);
  });

  it('an expired state is refused; DELETE revokes at Google and forgets the tokens', async () => {
    const users = app.get<UserRepository>(Domain.User.Repository);
    const user = await users.findByTelegramUserId(MOCK_TG_ID);
    const signer = app.get<ConnectStateSigner>(
      Domain.Integrations.ConnectStateSigner,
    );
    const old = signer.sign(user!.id, new Date(Date.now() - 11 * 60_000));
    const expired = await api()
      .get(
        `/api/v1/integrations/google/callback?code=good-code&state=${encodeURIComponent(old)}`,
      )
      .expect(400);
    expect(expired.text).toContain('expired');

    googleCalls.length = 0;
    const off = GoogleStatus.parse(
      (await authed(api().delete('/api/v1/integrations/google')).expect(200))
        .body,
    );
    expect(off).toEqual({ configured: true, connected: false });
    expect(
      googleCalls.find((c) =>
        c.url.startsWith('https://oauth2.googleapis.com/revoke'),
      )?.form,
    ).toEqual({ token: 'rt-1' });
    expect(await status()).toEqual({ configured: true, connected: false });
    const conn = app.get<Connection>(getConnectionToken());
    expect(
      await conn.db!.collection('google_connections').countDocuments(),
    ).toBe(0);
    // PATCH without a connection is 404; DELETE again is a no-op.
    await authed(api().patch('/api/v1/integrations/google'))
      .send({ calendarIds: [] })
      .expect(404);
    await authed(api().delete('/api/v1/integrations/google')).expect(200);
  });
});
