import { Inject, Injectable } from '@nestjs/common';
import type { ListSummary, TaskRepository } from '@domain/task/repository';
import { Domain } from '@common/tokens';

export type ListListsInput = { userId: string };
export type ListListsOutput = ListSummary[];

/** The user's named lists ("shopping", "ideas") with how much is on each. */
@Injectable()
export class ListListsUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async execute(input: ListListsInput): Promise<ListListsOutput> {
    return this.taskRepository.listSummaries(input.userId);
  }
}
