import { Injectable, Inject } from '@nestjs/common';
import type { Category, UserRepository } from '@domain/user';
import { Domain } from '@common/tokens';
import { InvalidInputError } from '@common/errors';
import { ListCategoriesUsecase } from '../list-categories';
import { type CategoryFields, normaliseKeywords } from '../create-category';
import { CategoryNotFoundError } from '../errors';

@Injectable()
export class UpdateCategoryUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
    private readonly listCategories: ListCategoriesUsecase,
  ) {}

  public async execute(input: {
    userId: string;
    categoryId: string;
    patch: Partial<CategoryFields>;
  }): Promise<Category> {
    const existing = await this.listCategories.execute({
      userId: input.userId,
    });
    const current = existing.find((c) => c.id === input.categoryId);
    if (!current) throw new CategoryNotFoundError(input.categoryId);

    const name = input.patch.name?.trim() ?? current.name;
    if (
      existing.some(
        (c) =>
          c.id !== current.id && c.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new InvalidInputError(`A category named "${name}" already exists`);
    }

    const updated: Category = {
      id: current.id,
      name,
      emoji: input.patch.emoji?.trim() ?? current.emoji,
      color: input.patch.color ?? current.color,
      keywords: input.patch.keywords
        ? normaliseKeywords(input.patch.keywords)
        : current.keywords,
    };
    await this.userRepository.update({
      id: input.userId,
      categories: existing.map((c) => (c.id === current.id ? updated : c)),
    });
    return updated;
  }
}
