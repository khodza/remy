import { Logger } from '@nestjs/common';
import { ConnectionStates, type Connection } from 'mongoose';
import type { TelegramBotService } from '@infra/bot/bot.service';
import {
  HealthService,
  MONGO_PING_TIMEOUT_MS,
  TELEGRAM_CACHE_DOWN_MS,
  TELEGRAM_CACHE_UP_MS,
} from './health.service';
import { HealthController } from '../controllers/health.controller';

describe('HealthService', () => {
  let clock: number;
  let ping: jest.Mock;
  let getMe: jest.Mock;
  let connection: { readyState: ConnectionStates; db: unknown };

  function makeService(): HealthService {
    const service = new HealthService(
      connection as unknown as Connection,
      {
        getBot: () => ({ api: { getMe } }),
      } as unknown as TelegramBotService,
    );
    jest
      .spyOn(service as unknown as { now: () => number }, 'now')
      .mockImplementation(() => clock);
    return service;
  }

  beforeEach(() => {
    clock = Date.parse('2026-09-23T10:00:00Z');
    ping = jest.fn().mockResolvedValue({ ok: 1 });
    getMe = jest.fn().mockResolvedValue({ id: 1, username: 'remy_bot' });
    connection = {
      readyState: ConnectionStates.connected,
      db: { admin: () => ({ ping }) },
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is ok when Mongo answers the ping and getMe works', async () => {
    const report = await makeService().check();
    expect(report).toMatchObject({
      status: 'ok',
      time: '2026-09-23T10:00:00.000Z',
      checks: {
        mongo: { status: 'up' },
        telegram: { status: 'up', checkedAt: '2026-09-23T10:00:00.000Z' },
      },
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('is down when Mongo is not connected, without pinging', async () => {
    connection.readyState = ConnectionStates.disconnected;
    const report = await makeService().check();
    expect(report.status).toBe('error');
    expect(report.checks.mongo).toEqual({
      status: 'down',
      reason: 'not connected',
    });
    expect(ping).not.toHaveBeenCalled();
  });

  it('is down when the ping fails, with a generic reason', async () => {
    ping.mockRejectedValue(new Error('connection refused 10.0.0.5:27017'));
    const report = await makeService().check();
    expect(report.status).toBe('error');
    expect(report.checks.mongo).toEqual({
      status: 'down',
      reason: 'ping failed',
    });
    expect(JSON.stringify(report)).not.toContain('10.0.0.5');
  });

  it('gives up on a hanging ping after the timeout', async () => {
    jest.useFakeTimers();
    ping.mockReturnValue(new Promise(() => undefined));
    const pending = makeService().check();
    await jest.advanceTimersByTimeAsync(MONGO_PING_TIMEOUT_MS + 1);
    const report = await pending;
    expect(report.checks.mongo).toEqual({ status: 'down', reason: 'timeout' });
  });

  it('caches getMe for a minute and shares one call between probes', async () => {
    const service = makeService();
    await Promise.all([service.check(), service.check(), service.check()]);
    expect(getMe).toHaveBeenCalledTimes(1);

    clock += TELEGRAM_CACHE_UP_MS - 1;
    await service.check();
    expect(getMe).toHaveBeenCalledTimes(1);
    // Mongo is pinged on every probe.
    expect(ping).toHaveBeenCalledTimes(4);

    clock += 2;
    await service.check();
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it('reports a Telegram failure and re-checks it sooner', async () => {
    getMe.mockRejectedValueOnce(new Error('401 Unauthorized'));
    const service = makeService();

    const down = await service.check();
    expect(down.status).toBe('error');
    expect(down.checks.telegram).toMatchObject({
      status: 'down',
      reason: 'getMe failed',
    });

    clock += TELEGRAM_CACHE_DOWN_MS + 1;
    const up = await service.check();
    expect(up.status).toBe('ok');
    expect(getMe).toHaveBeenCalledTimes(2);
  });
});

describe('HealthController', () => {
  const res = () => ({ status: jest.fn().mockReturnThis() });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('answers 200 (default status) when healthy', async () => {
    const report = { status: 'ok', checks: {} };
    const controller = new HealthController({
      check: jest.fn().mockResolvedValue(report),
    } as unknown as HealthService);
    const response = res();
    await expect(controller.check(response as never)).resolves.toBe(report);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('answers 503 with the per-check body when a check fails', async () => {
    const report = {
      status: 'error',
      checks: { mongo: { status: 'down' }, telegram: { status: 'up' } },
    };
    const controller = new HealthController({
      check: jest.fn().mockResolvedValue(report),
    } as unknown as HealthService);
    const response = res();
    await expect(controller.check(response as never)).resolves.toBe(report);
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
