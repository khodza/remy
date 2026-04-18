import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(authHeader: string | undefined): {
  context: ExecutionContext;
  request: { headers: { authorization?: string }; auth?: unknown };
} {
  const request: { headers: { authorization?: string }; auth?: unknown } = {
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

describe('JwtAuthGuard', () => {
  const secret = 'test-secret-min-32-bytes-long-abcdef123456';
  const jwtService = new JwtService({ secret, signOptions: { expiresIn: 900 } });
  const guard = new JwtAuthGuard(jwtService);

  it('accepts a valid Bearer token and populates req.auth', async () => {
    const token = await jwtService.signAsync({ sub: 'user-1', tgId: 42 });
    const { context, request } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual({ userId: 'user-1', telegramUserId: 42 });
  });

  it('rejects when Authorization header is missing', async () => {
    const { context } = makeContext(undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when scheme is not Bearer', async () => {
    const token = await jwtService.signAsync({ sub: 'user-1', tgId: 42 });
    const { context } = makeContext(`tma ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const otherSigner = new JwtService({ secret: 'different-secret' });
    const token = await otherSigner.signAsync({ sub: 'user-1', tgId: 42 });
    const { context } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const token = await jwtService.signAsync(
      { sub: 'user-1', tgId: 42 },
      { expiresIn: -10 as unknown as number },
    );
    const { context } = makeContext(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
