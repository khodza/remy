import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { InvalidInputError } from '@common/errors';

/** Throws unless `categoryId` is null/undefined or one of the user's categories. */
export async function assertCategoryBelongsToUser(
  userRepository: UserRepository,
  userId: string,
  categoryId: string | null | undefined,
): Promise<void> {
  if (categoryId === null || categoryId === undefined) return;
  const user = await userRepository.findById(userId);
  if (!user) throw new UserNotFoundError(`User ${userId} not found`);
  if (!(user.categories ?? []).some((c) => c.id === categoryId)) {
    throw new InvalidInputError('Unknown category');
  }
}
