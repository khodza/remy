import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import type { Express } from 'express';
import { Bot, webhookCallback } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { MessageHandler } from './handlers/message.handler';
import { CallbackHandler } from './handlers/callback.handler';
import { BOT_COMMANDS, CommandHandler } from './handlers/command.handler';
import { getEnv } from '@common/config';

/**
 * Webhook mode answers Telegram within this time; a slower update (a voice
 * note through Whisper and GPT) keeps running in the background so Telegram
 * does not redeliver it.
 */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Telegram sends WEBHOOK_SECRET in this header on every update. */
export const WEBHOOK_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

/** The Express handler grammY builds for the webhook route. */
export type WebhookHandler = ReturnType<
  typeof webhookCallback<never, 'express'>
>;

/**
 * Owns the grammY Bot: wires the handlers and receives updates either by
 * long polling (default) or, with BOT_MODE=webhook, on a POST route this
 * process serves at the path of WEBHOOK_URL.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot;
  private runner: RunnerHandle | undefined;
  private messageHandler!: MessageHandler;
  private callbackHandler!: CallbackHandler;
  private commandHandler!: CommandHandler;

  constructor(
    private moduleRef: ModuleRef,
    private httpAdapterHost: HttpAdapterHost,
  ) {
    this.bot = new Bot(getEnv().TELEGRAM_BOT_TOKEN);
  }

  public async onModuleInit(): Promise<void> {
    // Lazy injection to avoid circular dependency
    this.messageHandler = this.moduleRef.get(MessageHandler, { strict: false });
    this.callbackHandler = this.moduleRef.get(CallbackHandler, {
      strict: false,
    });
    this.commandHandler = this.moduleRef.get(CommandHandler, {
      strict: false,
    });

    // Setup handlers after lazy injection
    this.setupHandlers();

    // Populate Telegram's "/" menu. Non-fatal: the bot works without it.
    this.bot.api.setMyCommands([...BOT_COMMANDS]).catch((error: unknown) => {
      this.logger.warn(`Failed to register bot commands: ${describe(error)}`);
    });

    const env = getEnv();
    if (env.BOT_MODE === 'webhook') {
      // Validated together in env.ts; narrowed here for the type checker.
      if (env.WEBHOOK_URL === undefined || env.WEBHOOK_SECRET === undefined) {
        throw new Error(
          'BOT_MODE=webhook needs WEBHOOK_URL and WEBHOOK_SECRET',
        );
      }
      await this.startWebhook(env.WEBHOOK_URL, env.WEBHOOK_SECRET);
    } else {
      await this.dropWebhook();
      this.startPolling();
      this.logger.log('Telegram updates: long polling');
    }
  }

  /**
   * Long polling via @grammyjs/runner: updates are handled concurrently, so
   * a slow voice note (download + Whisper + GPT) no longer blocks button
   * taps until they expire. Overridable for tests.
   */
  protected startPolling(): void {
    this.runner = run(this.bot);
    this.runner.task()?.catch((error: unknown) => {
      this.logger.error(
        `Telegram bot polling stopped: ${describe(error)}. The bot will not respond to messages, but the scheduler still runs`,
      );
    });
  }

  /**
   * A webhook left over from a previous deployment would make getUpdates
   * fail with 409, so polling mode always clears it first. Non-fatal.
   */
  private async dropWebhook(): Promise<void> {
    try {
      await this.bot.api.deleteWebhook();
    } catch (error) {
      this.logger.warn(`Could not delete a stale webhook: ${describe(error)}`);
    }
  }

  /**
   * Serve `POST <path of WEBHOOK_URL>` and tell Telegram to use it. The route
   * goes on the Express instance directly (no /api/v1 prefix, no throttler
   * or JWT guard); Nest runs onModuleInit after the body parser and the
   * logging middleware are in place and before its 404 handler, so the
   * update arrives parsed and the secret header is already redacted in logs.
   */
  private async startWebhook(url: string, secret: string): Promise<void> {
    const path = new URL(url).pathname;
    const express = this.httpAdapterHost.httpAdapter.getInstance<Express>();
    express.post(path, this.webhookHandler(secret));

    try {
      // Fetch the bot's identity now rather than on the first update, so an
      // unauthorised request never triggers a Telegram call.
      await this.bot.init();
      await this.bot.api.setWebhook(url, { secret_token: secret });
      this.logger.log(`Telegram updates: webhook at ${url}`);
    } catch (error) {
      // Telegram keeps an earlier registration of the same URL, so serve it
      // anyway; /health reports Telegram as down until it answers.
      this.logger.error(`setWebhook failed: ${describe(error)}`);
    }
  }

  /**
   * grammY's Express handler: 401 unless X-Telegram-Bot-Api-Secret-Token
   * matches (constant-time), then the update runs through the same
   * middleware stack as polling.
   */
  public webhookHandler(secret: string): WebhookHandler {
    return webhookCallback(this.bot, 'express', {
      secretToken: secret,
      timeoutMilliseconds: WEBHOOK_TIMEOUT_MS,
      onTimeout: 'return',
    });
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.runner?.isRunning()) {
      await this.runner.stop();
    }
    this.logger.log('Telegram bot stopped');
  }

  public getBot(): Bot {
    return this.bot;
  }

  private setupHandlers(): void {
    // Without an error handler grammY stops long polling on the first error
    // thrown by any handler (e.g. a failed reply), silently killing the bot.
    this.bot.catch((err) => {
      this.logger.error(
        `Error while handling update ${err.ctx.update.update_id}: ${describe(err.error)}`,
        err.error instanceof Error ? err.error.stack : undefined,
      );
    });

    // Owner lock: Remy is a single-user bot. Everyone else gets one polite
    // line and no further processing (no DB writes, no OpenAI calls).
    this.bot.use(async (ctx, next) => {
      const owner = getEnv().OWNER_TELEGRAM_ID;
      if (owner === undefined || ctx.from?.id === owner) {
        await next();
        return;
      }
      if (ctx.callbackQuery) {
        await ctx
          .answerCallbackQuery({ text: '🔒 This is a private bot.' })
          .catch(() => undefined);
      } else if (ctx.message) {
        await ctx.reply('🔒 This is a private bot.').catch(() => undefined);
      }
    });

    // Commands
    this.bot.command('start', (ctx) => this.commandHandler.handleStart(ctx));
    this.bot.command('today', (ctx) => this.commandHandler.handleToday(ctx));
    this.bot.command('list', (ctx) => this.commandHandler.handleList(ctx));
    this.bot.command('delete', (ctx) => this.commandHandler.handleDelete(ctx));
    this.bot.command('settings', (ctx) =>
      this.commandHandler.handleSettings(ctx),
    );
    this.bot.command('export', (ctx) => this.commandHandler.handleExport(ctx));
    this.bot.command('help', (ctx) => this.commandHandler.handleHelp(ctx));

    // Forwarded messages come first: a forwarded text would otherwise be
    // read as an instruction. They are kept and Remy asks "when?".
    this.bot.on('message:forward_origin', (ctx) =>
      this.messageHandler.handleForward(ctx),
    );

    // Text messages
    this.bot.on('message:text', (ctx) => this.messageHandler.handleText(ctx));

    // Voice messages
    this.bot.on('message:voice', (ctx) => this.messageHandler.handleVoice(ctx));

    // Callback queries (inline buttons)
    this.bot.on('callback_query:data', (ctx) =>
      this.callbackHandler.handle(ctx),
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
