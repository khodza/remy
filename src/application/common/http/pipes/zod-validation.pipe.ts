import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body / query against a contract schema. Usage:
 *   @Body(new ZodValidationPipe(UpdateTaskRequest)) dto: UpdateTaskRequest
 * Contract objects are `.strict()`, so unknown keys are rejected just like
 * the old forbidNonWhitelisted ValidationPipe did.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
    throw new BadRequestException(message);
  }
}
