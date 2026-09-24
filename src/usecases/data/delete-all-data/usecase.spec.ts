import { DeleteAllDataUsecase } from './usecase';
import { UserNotFoundError } from '@domain/user';
import {
  makeUser,
  mockConversationRepository,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';

describe('DeleteAllDataUsecase', () => {
  it('removes tasks, conversation memory, categories and the feed, and resets settings', async () => {
    const users = mockUserRepository(
      makeUser({
        telegramUserId: 42,
        calendarToken: 'x'.repeat(43),
        categories: [],
        settings: {
          ...makeUser().settings,
          voiceBrief: true,
          defaultView: 'list',
        },
      }),
    );
    const tasks = mockTaskRepository();
    tasks.deleteAllForUser.mockResolvedValue(7);
    const conversations = mockConversationRepository();
    const google = { delete: jest.fn().mockResolvedValue(true) };

    const result = await new DeleteAllDataUsecase(
      users,
      tasks,
      conversations,
      google as never,
    ).execute({ userId: 'user-1' });

    expect(result).toEqual({ deletedTasks: 7 });
    expect(google.delete).toHaveBeenCalledWith('user-1');
    expect(tasks.deleteAllForUser).toHaveBeenCalledWith('user-1');
    expect(conversations.deleteAllForChat).toHaveBeenCalledWith(42);
    expect(users.current()).toMatchObject({
      calendarToken: null,
      categories: null,
      settings: makeUser().settings,
    });
  });

  it('404s an unknown user and touches nothing', async () => {
    const tasks = mockTaskRepository();
    await expect(
      new DeleteAllDataUsecase(
        mockUserRepository(),
        tasks,
        mockConversationRepository(),
      ).execute({ userId: 'ghost' }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    expect(tasks.deleteAllForUser).not.toHaveBeenCalled();
  });
});
