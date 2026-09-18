import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Category, UserRepository } from '@domain/user';
import { Domain } from '@common/tokens';
import { InvalidInputError } from '@common/errors';
import { ListCategoriesUsecase, newCategoryId } from '../list-categories';

export const MAX_CATEGORIES = 30;

export type CategoryFields = Omit<Category, 'id'>;

export function normaliseKeywords(keywords: string[]): string[] {
  return [
    ...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
  ];
}

@Injectable()
export class CreateCategoryUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
    private readonly listCategories: ListCategoriesUsecase,
  ) {}

  public async execute(input: {
    userId: string;
    category: CategoryFields;
  }): Promise<Category> {
    const existing = await this.listCategories.execute({
      userId: input.userId,
    });
    if (existing.length >= MAX_CATEGORIES) {
      throw new InvalidInputError(`At most ${MAX_CATEGORIES} categories`);
    }
    const name = input.category.name.trim();
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new InvalidInputError(`A category named "${name}" already exists`);
    }
    const created: Category = {
      id: newCategoryId(),
      name,
      emoji: input.category.emoji.trim(),
      color: input.category.color,
      keywords: normaliseKeywords(input.category.keywords),
    };
    await this.userRepository.update({
      id: input.userId,
      categories: [...existing, created],
    });
    return created;
  }
}
