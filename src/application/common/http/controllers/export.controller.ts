import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ExportDataUsecase } from '@usecases/data';
import { ExportRequest, type ExportResult } from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import type { AuthContext } from '../types';

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportData: ExportDataUsecase) {}

  /** The bot sends the file to the owner's chat; this answers what it sent. */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async export(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(ExportRequest)) dto: ExportRequest,
  ): Promise<ExportResult> {
    return this.exportData.execute({ userId: auth.userId, format: dto.format });
  }
}
