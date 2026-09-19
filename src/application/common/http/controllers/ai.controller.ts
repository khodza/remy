import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Domain } from '@common/tokens';
import type { TaskParserGateway } from '@domain/ai';
import type { RecurrenceInput } from '@contract/remy-contract';
import { recurrenceToWire } from '../mappers/task.mapper';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ParseTextRequest } from '@contract/remy-contract';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import type { AuthContext } from '../types';

export interface ParsedTaskDto {
  description: string;
  scheduledAt: string;
  recurrence: RecurrenceInput | null;
}

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    @Inject(Domain.AI.TaskParserGateway)
    private readonly taskParser: TaskParserGateway,
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  @Post('parse')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async parse(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(ParseTextRequest)) dto: ParseTextRequest,
  ): Promise<ParsedTaskDto> {
    const user = await this.userRepository.findById(auth.userId);
    if (!user) {
      throw new UserNotFoundError(`User ${auth.userId} not found`);
    }

    const result = await this.taskParser.parse({
      text: dto.text,
      ...(user.timezone ? { userTimezone: user.timezone } : {}),
    });

    return {
      description: result.description,
      scheduledAt: result.scheduledAt.toISOString(),
      recurrence: result.recurrence
        ? recurrenceToWire(result.recurrence)
        : null,
    };
  }
}
