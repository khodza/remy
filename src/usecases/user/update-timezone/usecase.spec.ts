import { UpdateTimezoneUsecase } from './usecase';
import type { UserRepository } from '@domain/user/repository';
import type { User } from '@domain/user';
import { InvalidInputError } from '@common/errors';
import { FailedToSaveUserError } from '@domain/user/errors';

describe('UpdateTimezoneUsecase', () => {
  let usecase: UpdateTimezoneUsecase;
  let userRepository: jest.Mocked<UserRepository>;

  const now = new Date('2026-04-16T12:00:00Z');

  const mockUser: User = {
    id: 'user-1',
    telegramUserId: 12345,
    firstName: 'John',
    lastName: null,
    username: null,
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

    usecase = new UpdateTimezoneUsecase(userRepository);
  });

  it('should update user timezone', async () => {
    userRepository.update.mockResolvedValue({
      ...mockUser,
      timezone: 'Asia/Tokyo',
    });

    const result = await usecase.execute({
      userId: 'user-1',
      timezone: 'Asia/Tokyo',
    });

    expect(userRepository.update).toHaveBeenCalledWith({
      id: 'user-1',
      timezone: 'Asia/Tokyo',
    });
    expect(result.timezone).toBe('Asia/Tokyo');
  });

  it('should throw InvalidInputError for invalid timezone', async () => {
    await expect(
      usecase.execute({ userId: 'user-1', timezone: 'invalid' }),
    ).rejects.toThrow(InvalidInputError);

    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('should throw InvalidInputError for empty timezone', async () => {
    await expect(
      usecase.execute({ userId: 'user-1', timezone: '' }),
    ).rejects.toThrow(InvalidInputError);
  });

  it('should wrap unexpected errors in FailedToSaveUserError', async () => {
    userRepository.update.mockRejectedValue(new Error('db error'));

    await expect(
      usecase.execute({ userId: 'user-1', timezone: 'UTC' }),
    ).rejects.toThrow(FailedToSaveUserError);
  });
});
