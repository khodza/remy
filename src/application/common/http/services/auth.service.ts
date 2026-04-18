import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { parse } from '@tma.js/init-data-node';
import { InvalidInputError } from '@common/errors';
import { EnsureUserUsecase } from '@usecases/user';
import type { User } from '@domain/user';

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

const DEFAULT_EXPIRES_IN = '15m';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly ensureUserUsecase: EnsureUserUsecase,
  ) {}

  async exchange(initDataRaw: string): Promise<AuthResult> {
    const parsed = parse(initDataRaw);
    const tgUser = parsed.user;
    if (!tgUser) {
      throw new InvalidInputError('initData does not contain a user');
    }

    const user = await this.ensureUserUsecase.execute({
      telegramUserId: tgUser.id,
      firstName: tgUser.first_name,
      ...(tgUser.last_name ? { lastName: tgUser.last_name } : {}),
      ...(tgUser.username ? { username: tgUser.username } : {}),
    });

    const expiresIn = (process.env['JWT_EXPIRES_IN'] ??
      DEFAULT_EXPIRES_IN) as unknown as number;
    const token = await this.jwtService.signAsync(
      { sub: user.id, tgId: user.telegramUserId },
      { expiresIn },
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
