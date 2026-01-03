import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Bot } from 'grammy';
import { MessageHandler } from './handlers/message.handler';
import { CallbackHandler } from './handlers/callback.handler';
import { CommandHandler } from './handlers/command.handler';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private bot: Bot;
  private messageHandler!: MessageHandler;
  private callbackHandler!: CallbackHandler;
  private commandHandler!: CommandHandler;

  constructor(private moduleRef: ModuleRef) {
    const token = process.env['TELEGRAM_BOT_TOKEN'];
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined');
    }
    this.bot = new Bot(token);
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

    // Start bot in background (don't await - it runs a long-polling loop)
    this.bot.start().catch((error) => {
      console.error('❌ Failed to start Telegram bot:', error);
      console.log('⚠️  Bot will not respond to messages, but scheduler will still run');
    });
    console.log('✅ Telegram bot starting in background...');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.bot.stop();
    console.log('Telegram bot stopped');
  }

  public getBot(): Bot {
    return this.bot;
  }

  private setupHandlers(): void {
    // Commands
    this.bot.command('start', (ctx) => this.commandHandler.handleStart(ctx));
    this.bot.command('list', (ctx) => this.commandHandler.handleList(ctx));
    this.bot.command('delete', (ctx) => this.commandHandler.handleDelete(ctx));
    this.bot.command('settings', (ctx) =>
      this.commandHandler.handleSettings(ctx),
    );
    this.bot.command('help', (ctx) => this.commandHandler.handleHelp(ctx));

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
