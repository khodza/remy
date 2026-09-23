import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { parse } from '@tma.js/init-data-node';
import { InvalidInputError } from '@common/errors';
import { EnsureUserUsecase } from '@usecases/user';
import type { User, UserRepository } from '@domain/user';
import { getEnv } from '@common/config';
import { Domain } from '@common/tokens';
import type { AuthContext } from '../types';

/**
 * How long a session may be kept alive with POST /auth/refresh after the
 * initData exchange that started it. After that the Mini App must be
 * reopened from the bot (fresh initData).
 */
export const MAX_SESSION_SECONDS = 7 * 24 * 60 * 60;

export interface AuthResult {
  token: string;
  expiresAt: string;
  user: UserDto;
}

export interface UserDto {
  id: string;
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  timezone: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly ensureUserUsecase: EnsureUserUsecase,
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  async exchange(initDataRaw: string): Promise<AuthResult> {
    const parsed = parse(initDataRaw);
    const tgUser = parsed.user;
    if (!tgUser) {
      throw new InvalidInputError('initData does not contain a user');
    }

    const ownerTimezone = getEnv().OWNER_TIMEZONE;
    const user = await this.ensureUserUsecase.execute({
      telegramUserId: tgUser.id,
      firstName: tgUser.first_name,
      ...(tgUser.last_name ? { lastName: tgUser.last_name } : {}),
      ...(tgUser.username ? { username: tgUser.username } : {}),
      ...(ownerTimezone ? { timezone: ownerTimezone } : {}),
    });

    return this.issue(user, Math.floor(Date.now() / 1000));
  }

  /**
   * A fresh token for a still-valid one (the guard already verified it and
   * the owner lock), so a Mini App left open doesn't dead-end when its
   * initData is too old to exchange again. The session start is carried
   * over and capped at MAX_SESSION_SECONDS.
   */
  async refresh(auth: AuthContext): Promise<AuthResult> {
    const now = Math.floor(Date.now() / 1000);
    const authAt = auth.authAt ?? now;
    if (now - authAt > MAX_SESSION_SECONDS) {
      throw new UnauthorizedException(
        'This session is too old. Reopen Remy from the bot.',
      );
    }
    const user = await this.userRepository.findById(auth.userId);
    if (!user) throw new UnauthorizedException('Unknown user');
    return this.issue(user, authAt);
  }

  private async issue(user: User, authAt: number): Promise<AuthResult> {
    const token = await this.jwtService.signAsync(
      { sub: user.id, tgId: user.telegramUserId, authAt },
      { expiresIn: getEnv().JWT_EXPIRES_IN as unknown as number },
    );
    const decoded = this.jwtService.decode<{ exp: number }>(token);
    const expiresAt = new Date(decoded.exp * 1000).toISOString();

    return { token, expiresAt, user: userToDto(user) };
  }

  toUserDto(user: User): UserDto {
    return userToDto(user);
  }
}

function userToDto(user: User): UserDto {
  return {
    id: user.id,
    telegramUserId: user.telegramUserId,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    timezone: user.timezone,
  };
}
