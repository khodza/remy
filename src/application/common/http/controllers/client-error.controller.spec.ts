import type { ExecutionContext } from '@nestjs/common';
import { Logger, PayloadTooLargeException } from '@nestjs/common';
import {
  CLIENT_ERROR_MAX_BYTES,
  ClientErrorController,
  ClientErrorSizeGuard,
} from './client-error.controller';

describe('ClientErrorController', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs one JSON line with the user id (newlines stay escaped)', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    new ClientErrorController().report(
      { userId: 'user-1', telegramUserId: 42 },
      { message: 'boom', stack: 'Error: boom\n  at x', kind: 'error' },
    );
    const line = String(warn.mock.calls[0]![0]);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      userId: 'user-1',
      message: 'boom',
      stack: 'Error: boom\n  at x',
      kind: 'error',
    });
  });

  it('refuses reports over the size cap before reading them', () => {
    const ctx = (length: number) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'content-length': String(length) },
          }),
        }),
      }) as unknown as ExecutionContext;
    const guard = new ClientErrorSizeGuard();
    expect(guard.canActivate(ctx(CLIENT_ERROR_MAX_BYTES))).toBe(true);
    expect(() => guard.canActivate(ctx(CLIENT_ERROR_MAX_BYTES + 1))).toThrow(
      PayloadTooLargeException,
    );
  });
});
