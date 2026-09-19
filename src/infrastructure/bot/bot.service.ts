import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Bot } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { MessageHandler } from './handlers/message.handler';
import { CallbackHandler } from './handlers/callback.handler';
import { BOT_COMMANDS, CommandHandler } from './handlers/command.handler';
import { getEnv } from '@common/config';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private bot: Bot;
  private runner: RunnerHandle | undefined;
  private messageHandler!: MessageHandler;
  private callbackHandler!: CallbackHandler;
  private commandHandler!: CommandHandler;

  constructor(private moduleRef: ModuleRef) {
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
      console.error('⚠️  Failed to register bot commands:', error);
    });

    this.startPolling();
    console.log('✅ Telegram bot polling in background...');
  }

  /**
   * Long polling via @grammyjs/runner: updates are handled concurrently, so
   * a slow voice note (download + Whisper + GPT) no longer blocks button
   * taps until they expire. Overridable for tests.
   */
  protected startPolling(): void {
    this.runner = run(this.bot);
    this.runner.task()?.catch((error: unknown) => {
      console.error('❌ Telegram bot polling stopped:', error);
      console.log(
        '⚠️  Bot will not respond to messages, but scheduler will still run',
      );
    });
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.runner?.isRunning()) {
      await this.runner.stop();
    }
    console.log('Telegram bot stopped');
  }

  public getBot(): Bot {
    return this.bot;
  }

  private setupHandlers(): void {
    // Without an error handler grammY stops long polling on the first error
    // thrown by any handler (e.g. a failed reply), silently killing the bot.
    this.bot.catch((err) => {
      console.error(
        `❌ Error while handling update ${err.ctx.update.update_id}:`,
        err.error,
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
    this.bot.command('list', (ctx) => this.commandHandler.handleList(ctx));
    this.bot.command('delete', (ctx) => this.commandHandler.handleDelete(ctx));
    this.bot.command('settings', (ctx) =>
      this.commandHandler.handleSettings(ctx),
    );
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
