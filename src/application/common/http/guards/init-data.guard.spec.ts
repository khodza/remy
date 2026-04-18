import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { sign } from '@tma.js/init-data-node';
import { InitDataGuard } from './init-data.guard';

const BOT_TOKEN = 'test-bot-token:AAHtest';

function makeContext(authHeader: string | undefined): {
  context: ExecutionContext;
  request: { headers: { authorization?: string }; initDataRaw?: string };
} {
  const request: { headers: { authorization?: string }; initDataRaw?: string } = {
    headers: {},
  };
  if (authHeader !== undefined) request.headers.authorization = authHeader;

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function sampleSignedInitData(authDate: Date, token = BOT_TOKEN): string {
  return sign(
    { user: { id: 42, first_name: 'Test' } },
    token,
    authDate,
  );
}

describe('InitDataGuard', () => {
  let guard: InitDataGuard;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = BOT_TOKEN;
    process.env['INIT_DATA_MAX_AGE_SECONDS'] = '86400';
    guard = new InitDataGuard();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts a valid HMAC-signed initData', () => {
    const initData = sampleSignedInitData(new Date());
    const { context, request } = makeContext(`tma ${initData}`);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.initDataRaw).toBe(initData);
  });

  it('rejects when Authorization header is missing', () => {
    const { context } = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects when scheme is not tma', () => {
    const initData = sampleSignedInitData(new Date());
    const { context } = makeContext(`Bearer ${initData}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects when HMAC signature is tampered', () => {
    const initData = sampleSignedInitData(new Date());
    const tampered = initData.replace(/hash=[^&]*/, 'hash=deadbeef');
    const { context } = makeContext(`tma ${tampered}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects expired initData', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const initData = sampleSignedInitData(twoDaysAgo);
    process.env['INIT_DATA_MAX_AGE_SECONDS'] = '60';
    const { context } = makeContext(`tma ${initData}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects when signed with a different bot token', () => {
    const initData = sampleSignedInitData(new Date(), 'different-token');
    const { context } = makeContext(`tma ${initData}`);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
