import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '@domain/user/repository';
import { Domain } from '@common/tokens';
import { EnsureUserInput, EnsureUserOutput } from './types';
import { ApplicationError } from '@domain/error';
import { FailedToSaveUserError } from '@domain/user/errors';
import type { User } from '@domain/user';

@Injectable()
export class EnsureUserUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  public async execute(input: EnsureUserInput): Promise<EnsureUserOutput> {
    try {
      // Try to find existing user
      const existingUser = await this.userRepository.findByTelegramUserId(
        input.telegramUserId,
      );

      if (existingUser !== null) {
        // People rename themselves in Telegram. Refresh the profile, but
        // write only when something actually changed (this runs on every
        // message and every Mini App login).
        if (!profileChanged(existingUser, input)) return existingUser;
        // save() upserts by telegramUserId and leaves timezone alone when
        // it is not passed, so this touches the names only.
        return await this.userRepository.save({
          telegramUserId: input.telegramUserId,
          firstName: input.firstName,
          lastName: input.lastName,
          username: input.username,
        });
      }

      // Create new user
      const user = await this.userRepository.save({
        telegramUserId: input.telegramUserId,
        firstName: input.firstName,
        lastName: input.lastName,
        username: input.username,
        timezone: input.timezone,
      });

      return user;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToSaveUserError('Failed to ensure user exists', error);
    }
  }
}

/** Telegram omits last_name / username when they are not set. */
function profileChanged(user: User, input: EnsureUserInput): boolean {
  return (
    user.firstName !== input.firstName ||
    user.lastName !== (input.lastName ?? null) ||
    user.username !== (input.username ?? null)
  );
}
