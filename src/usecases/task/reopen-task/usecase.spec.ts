import { ReopenTaskUsecase } from './usecase';
import { TaskStatus } from '@domain/task';
import { InvalidInputError } from '@common/errors';
import { makeTask, mockTaskRepository } from '@test/factories';

describe('ReopenTaskUsecase', () => {
  let repo: ReturnType<typeof mockTaskRepository>;
  let usecase: ReopenTaskUsecase;

  beforeEach(() => {
    repo = mockTaskRepository();
    usecase = new ReopenTaskUsecase(repo);
  });

  it('makes a completed task pending again and clears completedAt', async () => {
    const done = makeTask({
      status: TaskStatus.Completed,
      completedAt: new Date(),
    });
    repo.findById.mockResolvedValue(done);
    repo.update.mockResolvedValue(makeTask());
    await usecase.execute({ taskId: 'task-1' });
    expect(repo.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Pending,
      completedAt: null,
    });
  });

  it('is a no-op on a pending task', async () => {
    repo.findById.mockResolvedValue(makeTask());
    await usecase.execute({ taskId: 'task-1' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses a deleted task', async () => {
    repo.findById.mockResolvedValue(makeTask({ status: TaskStatus.Deleted }));
    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });
});
