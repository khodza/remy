import {
  CategoryNotFoundError,
  CreateCategoryUsecase,
  DeleteCategoryUsecase,
  ListCategoriesUsecase,
  UpdateCategoryUsecase,
} from '.';
import { InvalidInputError } from '@common/errors';
import { CategoryList } from '@contract/remy-contract';
import {
  makeUser,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';

describe('category use cases', () => {
  function setup(user = makeUser()) {
    const users = mockUserRepository(user);
    const tasks = mockTaskRepository();
    const list = new ListCategoriesUsecase(users);
    return {
      users,
      tasks,
      list,
      create: new CreateCategoryUsecase(users, list),
      update: new UpdateCategoryUsecase(users, list),
      remove: new DeleteCategoryUsecase(users, tasks, list),
    };
  }

  it('seeds the five defaults on first read, once, with contract-valid ids', async () => {
    const { list, users } = setup();
    const first = await list.execute({ userId: 'user-1' });
    expect(first.map((c) => c.name)).toEqual([
      'Work',
      'Home',
      'Health',
      'Errand',
      'Personal',
    ]);
    expect(() => CategoryList.parse({ categories: first })).not.toThrow();
    expect(first.every((c) => /^[0-9a-f]{24}$/.test(c.id))).toBe(true);

    const second = await list.execute({ userId: 'user-1' });
    expect(second).toEqual(first);
    expect(users.update).toHaveBeenCalledTimes(1);
  });

  it('respects an intentionally empty list', async () => {
    const { list, users } = setup(makeUser({ categories: [] }));
    expect(await list.execute({ userId: 'user-1' })).toEqual([]);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('creates with normalised keywords and rejects duplicate names', async () => {
    const { create } = setup();
    const created = await create.execute({
      userId: 'user-1',
      category: {
        name: ' Study ',
        emoji: '📚',
        color: '#123456',
        keywords: ['Exam', 'exam', ' book '],
      },
    });
    expect(created).toMatchObject({
      name: 'Study',
      keywords: ['exam', 'book'],
    });
    await expect(
      create.execute({
        userId: 'user-1',
        category: { name: 'work', emoji: 'x', color: '#000000', keywords: [] },
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('updates one category and leaves the rest', async () => {
    const { list, update, users } = setup();
    const [work] = await list.execute({ userId: 'user-1' });
    const updated = await update.execute({
      userId: 'user-1',
      categoryId: work!.id,
      patch: { color: '#000000' },
    });
    expect(updated).toMatchObject({
      id: work!.id,
      name: 'Work',
      color: '#000000',
    });
    expect(users.current().categories).toHaveLength(5);
    await expect(
      update.execute({
        userId: 'user-1',
        categoryId: 'f'.repeat(24),
        patch: {},
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('deleting a category uncategorises its tasks', async () => {
    const { list, remove, users, tasks } = setup();
    const [work] = await list.execute({ userId: 'user-1' });
    await remove.execute({ userId: 'user-1', categoryId: work!.id });
    expect(users.current().categories?.map((c) => c.name)).not.toContain(
      'Work',
    );
    expect(tasks.clearCategory).toHaveBeenCalledWith('user-1', work!.id);
  });
});
