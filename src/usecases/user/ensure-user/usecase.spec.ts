import { EnsureUserUsecase } from './usecase';
import type { UserRepository } from '@domain/user/repository';
import type { User } from '@domain/user';
import { FailedToSaveUserError } from '@domain/user/errors';
import { DEFAULT_USER_SETTINGS } from '@domain/user';

describe('EnsureUserUsecase', () => {
  let usecase: EnsureUserUsecase;
  let userRepository: jest.Mocked<UserRepository>;

  const now = new Date('2026-04-16T12:00:00Z');

  const mockUser: User = {
    id: 'user-1',
    telegramUserId: 12345,
    firstName: 'John',
    lastName: 'Doe',
    username: 'johndoe',
    timezone: 'UTC',
    settings: structuredClone(DEFAULT_USER_SETTINGS),
    categories: null,
    calendarToken: null,
    pinnedAgenda: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    userRepository = {
      save: jest.fn(),
      findByTelegramUserId: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      listAll: jest.fn(),
      claimDigest: jest.fn(),
      releaseDigest: jest.fn(),
      findByCalendarToken: jest.fn(),
    };

    usecase = new EnsureUserUsecase(userRepository);
  });

  it('should return existing user if found and unchanged', async () => {
    userRepository.findByTelegramUserId.mockResolvedValue(mockUser);

    const result = await usecase.execute({
      telegramUserId: 12345,
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
      timezone: 'Asia/Tashkent',
    });

    expect(userRepository.findByTelegramUserId).toHaveBeenCalledWith(12345);
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(result).toEqual(mockUser);
  });

  it.each([
    [
      'first name',
      { firstName: 'Johnny', lastName: 'Doe', username: 'johndoe' },
    ],
    [
      'last name',
      { firstName: 'John', lastName: 'Smith', username: 'johndoe' },
    ],
    ['username', { firstName: 'John', lastName: 'Doe', username: 'jd' }],
    ['a removed last name', { firstName: 'John', username: 'johndoe' }],
    ['a removed username', { firstName: 'John', lastName: 'Doe' }],
  ])(
    'refreshes an existing user whose %s changed, in one write',
    async (
      _what,
      names: { firstName: string; lastName?: string; username?: string },
    ) => {
      userRepository.findByTelegramUserId.mockResolvedValue(mockUser);
      const refreshed: User = {
        ...mockUser,
        firstName: names.firstName,
        lastName: names.lastName ?? null,
        username: names.username ?? null,
      };
      userRepository.save.mockResolvedValue(refreshed);

      const result = await usecase.execute({
        telegramUserId: 12345,
        ...names,
        timezone: 'Asia/Tashkent',
      });

      expect(userRepository.save).toHaveBeenCalledTimes(1);
      // Names only: the timezone of an existing user is never overwritten.
      expect(userRepository.save).toHaveBeenCalledWith({
        telegramUserId: 12345,
        firstName: names.firstName,
        lastName: names.lastName,
        username: names.username,
      });
      expect(userRepository.update).not.toHaveBeenCalled();
      expect(result).toEqual(refreshed);
    },
  );

  it('should create new user when not found', async () => {
    userRepository.findByTelegramUserId.mockResolvedValue(null);
    userRepository.save.mockResolvedValue(mockUser);

    const result = await usecase.execute({
      telegramUserId: 12345,
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
    });

    expect(userRepository.save).toHaveBeenCalledWith({
      telegramUserId: 12345,
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
    });
    expect(result).toEqual(mockUser);
  });

  it('should create user with minimal fields', async () => {
    userRepository.findByTelegramUserId.mockResolvedValue(null);
    userRepository.save.mockResolvedValue({
      ...mockUser,
      lastName: null,
      username: null,
    });

    await usecase.execute({
      telegramUserId: 12345,
      firstName: 'John',
    });

    expect(userRepository.save).toHaveBeenCalledWith({
      telegramUserId: 12345,
      firstName: 'John',
      lastName: undefined,
      username: undefined,
    });
  });

  it('should wrap unexpected errors in FailedToSaveUserError', async () => {
    userRepository.findByTelegramUserId.mockRejectedValue(
      new Error('db error'),
    );

    await expect(
      usecase.execute({ telegramUserId: 12345, firstName: 'John' }),
    ).rejects.toThrow(FailedToSaveUserError);
  });
});
