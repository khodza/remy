import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConnectionStates, type Connection } from 'mongoose';
import { TelegramBotService } from '@infra/bot/bot.service';

export type CheckStatus = 'up' | 'down';

export interface HealthCheck {
  status: CheckStatus;
  latencyMs?: number;
  /** Short and generic on purpose: /health is public. Details go to the log. */
  reason?: string;
}

export interface TelegramCheck extends HealthCheck {
  /** When the cached getMe result was taken. */
  checkedAt: string;
}

export interface HealthReport {
  status: 'ok' | 'error';
  time: string;
  uptimeSeconds: number;
  checks: { mongo: HealthCheck; telegram: TelegramCheck };
}

/** Mongo ping must answer within this, or the check is down. */
export const MONGO_PING_TIMEOUT_MS = 2_000;
export const TELEGRAM_TIMEOUT_MS = 3_000;
/** getMe is cached: health probes must not hammer Telegram. */
export const TELEGRAM_CACHE_UP_MS = 60_000;
/** A failure is re-checked sooner so recovery shows up quickly. */
export const TELEGRAM_CACHE_DOWN_MS = 15_000;

class TimeoutError extends Error {
  constructor() {
    super('timeout');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Readiness of the two things Remy can't work without: MongoDB (connection
 * state + a ping with a short timeout, every call) and the Telegram Bot API
 * (getMe, cached). Cheap enough for a Docker HEALTHCHECK every 30 s.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private telegramCache: { result: TelegramCheck; expiresAt: number } | null =
    null;
  private telegramInFlight: Promise<TelegramCheck> | null = null;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly botService: TelegramBotService,
  ) {}

  /** Clock, replaceable in tests. */
  protected now(): number {
    return Date.now();
  }

  async check(): Promise<HealthReport> {
    const [mongo, telegram] = await Promise.all([
      this.checkMongo(),
      this.checkTelegram(),
    ]);
    const ok = mongo.status === 'up' && telegram.status === 'up';
    return {
      status: ok ? 'ok' : 'error',
      time: new Date(this.now()).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: { mongo, telegram },
    };
  }

  private async checkMongo(): Promise<HealthCheck> {
    const state = this.connection.readyState;
    const db = this.connection.db;
    if (state !== ConnectionStates.connected || db === undefined) {
      this.logger.warn(
        `MongoDB not connected (state ${ConnectionStates[state] ?? state})`,
      );
      return { status: 'down', reason: 'not connected' };
    }
    const started = this.now();
    try {
      await withTimeout(db.admin().ping(), MONGO_PING_TIMEOUT_MS);
      return { status: 'up', latencyMs: this.now() - started };
    } catch (error) {
      this.logger.warn(`MongoDB ping failed: ${describe(error)}`);
      return {
        status: 'down',
        reason: error instanceof TimeoutError ? 'timeout' : 'ping failed',
      };
    }
  }

  private checkTelegram(): Promise<TelegramCheck> {
    const cached = this.telegramCache;
    if (cached !== null && cached.expiresAt > this.now()) {
      return Promise.resolve(cached.result);
    }
    // Concurrent probes share one getMe call.
    this.telegramInFlight ??= this.probeTelegram().finally(() => {
      this.telegramInFlight = null;
    });
    return this.telegramInFlight;
  }

  private async probeTelegram(): Promise<TelegramCheck> {
    const started = this.now();
    let result: TelegramCheck;
    try {
      await withTimeout(
        this.botService.getBot().api.getMe(),
        TELEGRAM_TIMEOUT_MS,
      );
      result = {
        status: 'up',
        latencyMs: this.now() - started,
        checkedAt: new Date(started).toISOString(),
      };
    } catch (error) {
      this.logger.warn(`Telegram getMe failed: ${describe(error)}`);
      result = {
        status: 'down',
        reason: error instanceof TimeoutError ? 'timeout' : 'getMe failed',
        checkedAt: new Date(started).toISOString(),
      };
    }
    const ttl =
      result.status === 'up' ? TELEGRAM_CACHE_UP_MS : TELEGRAM_CACHE_DOWN_MS;
    this.telegramCache = { result, expiresAt: this.now() + ttl };
    return result;
  }
}
