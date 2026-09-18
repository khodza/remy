import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateCategoryUsecase,
  DeleteCategoryUsecase,
  ListCategoriesUsecase,
  UpdateCategoryUsecase,
} from '@usecases/category';
import {
  CreateCategoryRequest,
  UpdateCategoryRequest,
  type Category,
  type DeleteResult,
} from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import type { AuthContext } from '../types';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoryController {
  constructor(
    private readonly listCategories: ListCategoriesUsecase,
    private readonly createCategory: CreateCategoryUsecase,
    private readonly updateCategory: UpdateCategoryUsecase,
    private readonly deleteCategory: DeleteCategoryUsecase,
  ) {}

  @Get()
  async list(
    @CurrentUser() auth: AuthContext,
  ): Promise<{ categories: Category[] }> {
    return {
      categories: await this.listCategories.execute({ userId: auth.userId }),
    };
  }

  @Post()
  async create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateCategoryRequest))
    dto: CreateCategoryRequest,
  ): Promise<Category> {
    return this.createCategory.execute({ userId: auth.userId, category: dto });
  }

  @Patch(':id')
  async update(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCategoryRequest))
    dto: UpdateCategoryRequest,
  ): Promise<Category> {
    const patch = JSON.parse(JSON.stringify(dto)) as Partial<
      Omit<Category, 'id'>
    >;
    return this.updateCategory.execute({
      userId: auth.userId,
      categoryId: id,
      patch,
    });
  }

  @Delete(':id')
  async remove(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<DeleteResult> {
    return this.deleteCategory.execute({ userId: auth.userId, categoryId: id });
  }
}
