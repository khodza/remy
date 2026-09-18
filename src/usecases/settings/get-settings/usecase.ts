import { Injectable, Inject } from '@nestjs/common';
import type { UserRepository, UserSettings } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { Domain } from '@common/tokens';

@Injectable()
export class GetSettingsUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  public async execute(input: { userId: string }): Promise<UserSettings> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);
    return user.settings; // already merged with defaults by the repository
  }
}
