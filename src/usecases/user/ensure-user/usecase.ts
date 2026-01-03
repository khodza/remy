import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '@domain/user/repository';
import { Domain } from '@common/tokens';
import { EnsureUserInput, EnsureUserOutput } from './types';
import { ApplicationError } from '@domain/error';
import { FailedToSaveUserError } from '@domain/user/errors';

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
        return existingUser;
      }

      // Create new user
      const user = await this.userRepository.save({
        telegramUserId: input.telegramUserId,
        firstName: input.firstName,
        lastName: input.lastName,
        username: input.username,
      });

      return user;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToSaveUserError('Failed to ensure user exists', error);
    }
  }
}
