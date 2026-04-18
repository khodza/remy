import {
  Body,
  Controller,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Domain } from '@common/tokens';
import type { TaskParserGateway } from '@domain/ai';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ParseTextDto } from '../dto/parse-text.dto';
import type { AuthContext } from '../types';

export interface ParsedTaskDto {
  description: string;
  scheduledAt: string;
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
  async parse(
    @CurrentUser() auth: AuthContext,
    @Body() dto: ParseTextDto,
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
    };
  }
}
