import type { Context } from 'grammy';
import { ConnectCommandHandler } from './connect.handler';
import { makeUser } from '@test/factories';

type Reply = { text: string; keyboard: { text: string; url?: string }[][] };

function fakeCtx(text: string, match = '') {
  const replies: Reply[] = [];
  const ctx = {
    from: { id: 42, first_name: 'Owner' },
    chat: { id: 42 },
    match,
    message: { text },
    reply: jest.fn(async (t: string, other?: { reply_markup?: unknown }) => {
      const markup = other?.reply_markup as
        | { inline_keyboard: { text: string; url?: string }[][] }
        | undefined;
      replies.push({ text: t, keyboard: markup?.inline_keyboard ?? [] });
      return { message_id: 1 };
    }),
  } as unknown as Context;
  return { ctx, replies };
}

function setup(status: unknown) {
  const ensureUser = { execute: jest.fn(async () => makeUser()) };
  const getStatus = { execute: jest.fn(async () => status) };
  const startConnect = {
    execute: jest.fn(async () => ({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s',
    })),
  };
  const disconnect = {
    execute: jest.fn(async () => ({ configured: true, connected: false })),
  };
  const handler = new ConnectCommandHandler(
    ensureUser as never,
    getStatus as never,
    startConnect as never,
    disconnect as never,
  );
  return { handler, disconnect, startConnect };
}

describe('ConnectCommandHandler', () => {
  it('explains when the server has no Google client', async () => {
    const { handler } = setup({ configured: false, connected: false });
    const { ctx, replies } = fakeCtx('/connect');
    await handler.handleConnect(ctx);
    expect(replies[0]?.text).toContain('not set up on this server');
    expect(replies[0]?.keyboard).toEqual([]);
  });

  it('offers the consent link as a URL button when not connected', async () => {
    const { handler, startConnect } = setup({
      configured: true,
      connected: false,
    });
    const { ctx, replies } = fakeCtx('/connect');
    await handler.handleConnect(ctx);
    expect(startConnect.execute).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(replies[0]?.keyboard).toEqual([
      [
        {
          text: '🔗 Connect Google Calendar',
          url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s',
        },
      ],
    ]);
  });

  it('shows the account and the selected calendars when connected', async () => {
    const { handler, startConnect } = setup({
      configured: true,
      connected: true,
      email: 'owner@example.com',
      calendars: [
        { id: 'p', summary: 'Owner <3', selected: true },
        { id: 'f', summary: 'Family', selected: false },
      ],
    });
    const { ctx, replies } = fakeCtx('/connect');
    await handler.handleConnect(ctx);
    expect(replies[0]?.text).toContain('connected</b> as owner@example.com');
    expect(replies[0]?.text).toContain('In your brief: Owner &lt;3');
    expect(replies[0]?.text).toContain('Not shown: Family');
    expect(startConnect.execute).not.toHaveBeenCalled();
  });

  it('"/connect off" disconnects', async () => {
    const { handler, disconnect } = setup({
      configured: true,
      connected: true,
    });
    const { ctx, replies } = fakeCtx('/connect off', 'off');
    await handler.handleConnect(ctx);
    expect(disconnect.execute).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(replies[0]?.text).toContain('disconnected');
  });
});
