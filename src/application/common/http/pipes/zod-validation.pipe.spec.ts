import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe';
import { ListTasksQuery, UpdateTaskRequest } from '@contract/remy-contract';

describe('ZodValidationPipe', () => {
  it('returns the parsed value (with coercion for query strings)', () => {
    expect(
      new ZodValidationPipe(ListTasksQuery).transform({
        view: 'done',
        limit: '5',
      }),
    ).toEqual({
      view: 'done',
      limit: 5,
    });
  });

  it('keeps null distinct from absent', () => {
    expect(
      new ZodValidationPipe(UpdateTaskRequest).transform({ scheduledAt: null }),
    ).toEqual({
      scheduledAt: null,
    });
  });

  it('rejects unknown keys and bad values with a readable 400', () => {
    const pipe = new ZodValidationPipe(UpdateTaskRequest);
    expect(() => pipe.transform({ status: 'completed' })).toThrow(
      BadRequestException,
    );
    try {
      pipe.transform({ priority: 'urgent', scheduledAt: 'tomorrow' });
    } catch (e) {
      expect((e as BadRequestException).message).toMatch(/priority/);
      expect((e as BadRequestException).message).toMatch(/scheduledAt/);
    }
  });
});
