import { Controller, Get, UseGuards } from '@nestjs/common';
import { ListListsUsecase } from '@usecases/task';
import type { ListSummaries } from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthContext } from '../types';

/** Named lists ("shopping"); the tasks on one are GET /tasks?list=<name>. */
@Controller('lists')
@UseGuards(JwtAuthGuard)
export class ListController {
  constructor(private readonly listLists: ListListsUsecase) {}

  @Get()
  async list(@CurrentUser() auth: AuthContext): Promise<ListSummaries> {
    return { lists: await this.listLists.execute({ userId: auth.userId }) };
  }
}
