import { ApplicationError } from '@domain/error';

export class CategoryNotFoundError extends ApplicationError {
  constructor(categoryId: string) {
    super(`Category ${categoryId} not found`);
  }
}
