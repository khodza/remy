import {
  Body,
  Controller,
  Delete,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeleteAllDataUsecase } from '@usecases/data';
import {
  DeleteAllDataRequest,
  type DeleteAllDataResult,
} from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PinnedAgendaInterceptor } from '../interceptors/pinned-agenda.interceptor';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import type { AuthContext } from '../types';

@Controller('data')
@UseGuards(JwtAuthGuard)
// Settings go back to defaults, so the pinned agenda comes down with the data.
@UseInterceptors(PinnedAgendaInterceptor)
export class AccountDataController {
  constructor(private readonly deleteAllData: DeleteAllDataUsecase) {}

  /** "Delete all my data". The body must be { confirm: "DELETE" }. */
  @Delete()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async deleteAll(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(DeleteAllDataRequest))
    _dto: DeleteAllDataRequest,
  ): Promise<DeleteAllDataResult> {
    const { deletedTasks } = await this.deleteAllData.execute({
      userId: auth.userId,
    });
    return { success: true, deletedTasks };
  }
}
