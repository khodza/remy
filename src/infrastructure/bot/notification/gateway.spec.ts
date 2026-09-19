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
    kind: 'due' as const,
    dueAt: new Date('2026-04-16T12:00:00Z'),
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
    sendMessage = jest.fn().mockResolvedValue({ message_id: 77 });
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

  it('returns the Telegram message id so replies can be linked to the task', async () => {
    await expect(gateway.sendReminder(input)).resolves.toEqual({
      messageId: 77,
    });
  });

  it('labels every snooze button with the resulting time in the task zone', async () => {
    jest.useFakeTimers({ now: new Date('2026-04-16T09:47:00Z') }); // 14:47 Tashkent
    await gateway.sendReminder(input);
    jest.useRealTimers();
    const keyboard = sendMessage.mock.calls[0][2].reply_markup
      .inline_keyboard as Array<
      Array<{ text: string; callback_data?: string }>
    >;
    expect(keyboard.flat().map((b) => [b.text, b.callback_data])).toEqual([
      ['✅ Done', 'complete:task-1'],
      ['+15m → 15:02', 'delay:task-1:15'],
      ['+1h → 15:47', 'delay:task-1:60'],
      ['Tonight 20:00', 'snz:task-1:tonight'],
      ['Tomorrow 09:00', 'snz:task-1:tomorrow'],
    ]);
  });

  it('a nudge says how long it has been open and offers the full keyboard', async () => {
    jest.useFakeTimers({ now: new Date('2026-04-16T12:47:00Z') });
    await gateway.sendReminder({ ...input, kind: 'nudge', nudgeNumber: 1 });
    jest.useRealTimers();
    expect(sendMessage.mock.calls[0][1]).toContain(
      'Still open</b> · 47 min since it was due',
    );
    expect(
      sendMessage.mock.calls[0][2].reply_markup.inline_keyboard.flat().length,
    ).toBeGreaterThan(1);
  });

  it('a heads-up says how long is left and only offers Done', async () => {
    jest.useFakeTimers({ now: new Date('2026-04-16T11:30:00Z') });
    await gateway.sendReminder({ ...input, kind: 'heads_up' });
    jest.useRealTimers();
    expect(sendMessage.mock.calls[0][1]).toContain('In 30 min');
    const keyboard = sendMessage.mock.calls[0][2].reply_markup.inline_keyboard;
    expect(keyboard.flat()).toHaveLength(1);
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
