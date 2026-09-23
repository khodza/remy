import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ParseListRequest,
  ParseTextRequest,
  type ImportDraftsWire,
  type ParsedTaskWire,
} from '@contract/remy-contract';
import { ParseListUsecase } from '@usecases/data';
import { ParseTaskUsecase } from '@usecases/task';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { toDraftWire } from '../mappers/task.mapper';
import type { AuthContext } from '../types';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly parseTaskUsecase: ParseTaskUsecase,
    private readonly parseListUsecase: ParseListUsecase,
  ) {}

  /** A pasted list → drafts to review in the app; nothing is saved. */
  @Post('parse-list')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async parseList(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(ParseListRequest)) dto: ParseListRequest,
  ): Promise<ImportDraftsWire> {
    const drafts = await this.parseListUsecase.execute({
      userId: auth.userId,
      text: dto.text,
    });
    return { tasks: drafts.map(toDraftWire) };
  }

  /**
   * The Create preview: what the text holds, in the user's zone (OWNER_TIMEZONE
   * fallback, like every task route). Nothing is saved; not a task → 422.
   */
  @Post('parse')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async parse(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(ParseTextRequest)) dto: ParseTextRequest,
  ): Promise<ParsedTaskWire> {
    const drafts = (
      await this.parseTaskUsecase.execute({
        userId: auth.userId,
        text: dto.text,
      })
    ).map(toDraftWire);
    return { ...drafts[0]!, drafts };
  }
}
