import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { sign } from '@tma.js/init-data-node';
import { InitDataGuard } from './init-data.guard';

const BOT_TOKEN = 'test-bot-token:AAHtest';

function makeContext(authHeader: string | undefined): {
  context: ExecutionContext;
  request: { headers: { authorization?: string }; initDataRaw?: string };
} {
  const request: { headers: { authorization?: string }; initDataRaw?: string } =
    {
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
  return sign({ user: { id: 42, first_name: 'Test' } }, token, authDate);
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

  describe('owner lock', () => {
    it('rejects a valid initData from a user other than the owner', () => {
      process.env['OWNER_TELEGRAM_ID'] = '999';
      const initData = sampleSignedInitData(new Date()); // user id 42
      const { context } = makeContext(`tma ${initData}`);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('accepts the owner', () => {
      process.env['OWNER_TELEGRAM_ID'] = '42';
      const initData = sampleSignedInitData(new Date());
      const { context } = makeContext(`tma ${initData}`);
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('dev mock initData', () => {
    const mockInitData = (user: string) =>
      `auth_date=${Math.floor(Date.now() / 1000)}&user=${encodeURIComponent(user)}&hash=dev-mock-hash`;

    it('is rejected unless DEV_ALLOW_MOCK_INITDATA is on', () => {
      const { context } = makeContext(
        `tma ${mockInitData('{"id":123,"first_name":"Dev"}')}`,
      );
      expect(() => guard.canActivate(context)).toThrow(
        /Mock initData is not accepted/,
      );
    });

    it('is accepted when enabled outside production', () => {
      process.env['DEV_ALLOW_MOCK_INITDATA'] = 'true';
      const raw = mockInitData('{"id":123,"first_name":"Dev"}');
      const { context, request } = makeContext(`tma ${raw}`);
      expect(guard.canActivate(context)).toBe(true);
      // Normalised so AuthService can parse() it like real initData.
      expect(request.initDataRaw).toContain('hash=dev-mock-hash');
      expect(request.initDataRaw).toContain('signature=');
    });

    it('still enforces the owner lock', () => {
      process.env['DEV_ALLOW_MOCK_INITDATA'] = 'true';
      process.env['OWNER_TELEGRAM_ID'] = '123';
      const other = makeContext(
        `tma ${mockInitData('{"id":7,"first_name":"Other"}')}`,
      );
      expect(() => guard.canActivate(other.context)).toThrow(
        ForbiddenException,
      );
      const owner = makeContext(
        `tma ${mockInitData('{"id":123,"first_name":"Dev"}')}`,
      );
      expect(guard.canActivate(owner.context)).toBe(true);
    });

    it('requires a user with a numeric id and an auth_date', () => {
      process.env['DEV_ALLOW_MOCK_INITDATA'] = 'true';
      const noUser = makeContext(`tma auth_date=1&hash=dev-mock-hash`);
      expect(() => guard.canActivate(noUser.context)).toThrow(
        UnauthorizedException,
      );
      const noDate = makeContext(
        `tma user=${encodeURIComponent('{"id":1}')}&hash=dev-mock-hash`,
      );
      expect(() => guard.canActivate(noDate.context)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
