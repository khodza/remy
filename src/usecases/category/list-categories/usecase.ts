import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Category, UserRepository } from '@domain/user';
import { DEFAULT_CATEGORIES, UserNotFoundError } from '@domain/user';
import { Domain } from '@common/tokens';

/** 24-char hex, the same shape as the ids the rest of the API uses. */
export function newCategoryId(): string {
  return randomBytes(12).toString('hex');
}

@Injectable()
export class ListCategoriesUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * The defaults are created the first time categories are read. `null`
   * means "never initialised"; an empty array means the user deleted them
   * all and wants it that way.
   */
  public async execute(input: { userId: string }): Promise<Category[]> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);
    if (user.categories !== null) return user.categories;

    const seeded = DEFAULT_CATEGORIES.map((c) => ({
      ...c,
      keywords: [...c.keywords],
      id: newCategoryId(),
    }));
    const updated = await this.userRepository.update({
      id: input.userId,
      categories: seeded,
    });
    return updated.categories ?? seeded;
  }
}
