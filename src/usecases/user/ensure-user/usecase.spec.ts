import { EnsureUserUsecase } from './usecase';
import type { UserRepository } from '@domain/user/repository';
import type { User } from '@domain/user';
import { FailedToSaveUserError } from '@domain/user/errors';

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
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    userRepository = {
      save: jest.fn(),
      findByTelegramUserId: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
    };

    usecase = new EnsureUserUsecase(userRepository);
  });

  it('should return existing user if found', async () => {
    userRepository.findByTelegramUserId.mockResolvedValue(mockUser);

    const result = await usecase.execute({
      telegramUserId: 12345,
      firstName: 'John',
    });

    expect(userRepository.findByTelegramUserId).toHaveBeenCalledWith(12345);
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(result).toEqual(mockUser);
  });

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
