import { JwtService } from '@nestjs/jwt';
import { sign } from '@tma.js/init-data-node';
import type { User } from '@domain/user';
import { EnsureUserUsecase } from '@usecases/user';
import { InvalidInputError } from '@common/errors';
import { AuthService } from './auth.service';

const BOT_TOKEN = 'test-bot-token:AAHtest';
const JWT_SECRET = 'test-jwt-secret-must-be-32+-chars-abcdef';

describe('AuthService', () => {
  let jwtService: JwtService;
  let ensureUserUsecase: jest.Mocked<Pick<EnsureUserUsecase, 'execute'>>;
  let service: AuthService;

  const now = new Date('2026-04-18T12:00:00Z');
  const user: User = {
    id: 'user-1',
    telegramUserId: 42,
    firstName: 'Test',
    lastName: null,
    username: null,
    timezone: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    process.env['JWT_SECRET'] = JWT_SECRET;
    process.env['JWT_EXPIRES_IN'] = '15m';

    jwtService = new JwtService({ secret: JWT_SECRET });
    ensureUserUsecase = { execute: jest.fn().mockResolvedValue(user) };
    service = new AuthService(
      jwtService,
      ensureUserUsecase as unknown as EnsureUserUsecase,
    );
  });

  it('exchanges valid initData for a JWT and user DTO', async () => {
    const initData = sign(
      { user: { id: 42, first_name: 'Test' } },
      BOT_TOKEN,
      now,
    );

    const result = await service.exchange(initData);

    expect(ensureUserUsecase.execute).toHaveBeenCalledWith({
      telegramUserId: 42,
      firstName: 'Test',
    });
    expect(result.user).toMatchObject({
      id: 'user-1',
      telegramUserId: 42,
      firstName: 'Test',
    });
    expect(typeof result.token).toBe('string');
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const decoded = jwtService.verify<{ sub: string; tgId: number }>(result.token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.tgId).toBe(42);
  });

  it('throws InvalidInputError when initData has no user', async () => {
    const initData = sign({}, BOT_TOKEN, now);
    await expect(service.exchange(initData)).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('forwards optional fields (lastName, username) when present', async () => {
    const initData = sign(
      {
        user: {
          id: 42,
          first_name: 'Test',
          last_name: 'Person',
          username: 'tester',
        },
      },
      BOT_TOKEN,
      now,
    );

    await service.exchange(initData);

    expect(ensureUserUsecase.execute).toHaveBeenCalledWith({
      telegramUserId: 42,
      firstName: 'Test',
      lastName: 'Person',
      username: 'tester',
    });
  });
});
