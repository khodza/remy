import { GrammyError } from 'grammy';
import { NotificationFailedError } from '@domain/notification/errors';
import type { TelegramBotService } from '../bot.service';
import { NotificationGatewayImpl } from './gateway';

describe('NotificationGatewayImpl', () => {
  let sendMessage: jest.Mock;
  let gateway: NotificationGatewayImpl;

  const input = {
    chatId: 12345,
    taskId: 'task-1',
    description: 'email john_doe about <Q3> & *budget*',
    scheduledAt: new Date('2026-04-16T12:00:00Z'),
    timezone: 'Asia/Tashkent',
  };

  const telegramError = (errorCode: number, description: string) =>
    new GrammyError(
      `Call to 'sendMessage' failed! (${errorCode}: ${description})`,
      { ok: false, error_code: errorCode, description },
      'sendMessage',
      {},
    );

  beforeEach(() => {
    sendMessage = jest.fn().mockResolvedValue(undefined);
    const botService = {
      getBot: () => ({ api: { sendMessage } }),
    } as unknown as TelegramBotService;
    gateway = new NotificationGatewayImpl(botService);
  });

  it('should send the description HTML-escaped', async () => {
    await gateway.sendReminder(input);

    expect(sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining('email john_doe about &lt;Q3&gt; &amp; *budget*'),
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
  });

  it('should show the time in the task timezone', async () => {
    await gateway.sendReminder(input);

    expect(sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining('Thu 16 Apr 2026, 17:00'), // 12:00Z in UTC+5
      expect.anything(),
    );
  });

  it.each([
    [400, 'Bad Request: chat not found'],
    [403, 'Forbidden: bot was blocked by the user'],
  ])('should mark a %i error as permanent', async (code, description) => {
    sendMessage.mockRejectedValue(telegramError(code, description));

    const error: unknown = await gateway
      .sendReminder(input)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotificationFailedError);
    expect((error as NotificationFailedError).permanent).toBe(true);
  });

  it.each([
    ['a 429', telegramError(429, 'Too Many Requests: retry after 5')],
    ['a 502', telegramError(502, 'Bad Gateway')],
    ['a network', new Error('ECONNRESET')],
  ])('should mark %s error as retryable', async (_label, cause) => {
    sendMessage.mockRejectedValue(cause);

    const error: unknown = await gateway
      .sendReminder(input)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotificationFailedError);
    expect((error as NotificationFailedError).permanent).toBe(false);
  });
});
