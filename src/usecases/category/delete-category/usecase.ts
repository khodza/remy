import { Injectable, Inject } from '@nestjs/common';
import type { UserRepository } from '@domain/user';
import type { TaskRepository } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { ListCategoriesUsecase } from '../list-categories';
import { CategoryNotFoundError } from '../errors';

@Injectable()
export class DeleteCategoryUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    private readonly listCategories: ListCategoriesUsecase,
  ) {}

  /** Tasks that carried the category become uncategorised; they are not deleted. */
  public async execute(input: {
    userId: string;
    categoryId: string;
  }): Promise<{ success: true }> {
    const existing = await this.listCategories.execute({
      userId: input.userId,
    });
    if (!existing.some((c) => c.id === input.categoryId)) {
      throw new CategoryNotFoundError(input.categoryId);
    }
    await this.userRepository.update({
      id: input.userId,
      categories: existing.filter((c) => c.id !== input.categoryId),
    });
    await this.taskRepository.clearCategory(input.userId, input.categoryId);
    return { success: true };
  }
}
