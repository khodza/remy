import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from '@domain/user/repository';
import { Domain } from '@common/tokens';
import { UpdateTimezoneInput, UpdateTimezoneOutput } from './types';
import { ApplicationError } from '@domain/error';
import { FailedToSaveUserError } from '@domain/user/errors';
import { validateTimezone } from '@common/validation';

@Injectable()
export class UpdateTimezoneUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  public async execute(
    input: UpdateTimezoneInput,
  ): Promise<UpdateTimezoneOutput> {
    try {
      // Validate timezone
      validateTimezone(input.timezone);

      const user = await this.userRepository.update({
        id: input.userId,
        timezone: input.timezone,
      });

      return user;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToSaveUserError('Failed to update timezone', error);
    }
  }
}
