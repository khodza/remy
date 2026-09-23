import { ListListsUsecase } from './usecase';
import { mockTaskRepository } from '@test/factories';

describe('ListListsUsecase', () => {
  it("returns the repository's per-list counts for the user", async () => {
    const tasks = mockTaskRepository();
    tasks.listSummaries.mockResolvedValue([
      { name: 'shopping', pending: 2, completed: 1 },
    ]);
    await expect(
      new ListListsUsecase(tasks).execute({ userId: 'user-1' }),
    ).resolves.toEqual([{ name: 'shopping', pending: 2, completed: 1 }]);
    expect(tasks.listSummaries).toHaveBeenCalledWith('user-1');
  });
});
