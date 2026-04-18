import { ForbiddenException } from '@nestjs/common';
import type { Task, TaskRepository } from '@domain/task';
import { TaskNotFoundError, TaskStatus } from '@domain/task';
import type { User, UserRepository } from '@domain/user';
import type {
  DelayTaskUsecase,
  DeleteTaskUsecase,
  ListTasksUsecase,
  MarkCompleteUsecase,
  ProcessTextMessageUsecase,
  ProcessVoiceMessageUsecase,
} from '@usecases/task';
import { TaskController } from './task.controller';
import type { AuthContext } from '../types';

describe('TaskController', () => {
  const now = new Date('2026-04-18T12:00:00Z');
  const auth: AuthContext = { userId: 'owner-1', telegramUserId: 42 };
  const foreignAuth: AuthContext = { userId: 'intruder', telegramUserId: 99 };

  const ownedTask: Task = {
    id: 'task-1',
    userId: 'owner-1',
    telegramChatId: 42,
    description: 'Buy milk',
    scheduledAt: new Date('2026-04-19T09:00:00Z'),
    status: TaskStatus.Pending,
    createdAt: now,
    updatedAt: now,
  };

  const owner: User = {
    id: 'owner-1',
    telegramUserId: 42,
    firstName: 'Owner',
    lastName: null,
    username: null,
    timezone: 'America/New_York',
    createdAt: now,
    updatedAt: now,
  };

  let taskRepository: jest.Mocked<TaskRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let listTasks: jest.Mocked<Pick<ListTasksUsecase, 'execute'>>;
  let processText: jest.Mocked<Pick<ProcessTextMessageUsecase, 'execute'>>;
  let processVoice: jest.Mocked<Pick<ProcessVoiceMessageUsecase, 'execute'>>;
  let markComplete: jest.Mocked<Pick<MarkCompleteUsecase, 'execute'>>;
  let delayTask: jest.Mocked<Pick<DelayTaskUsecase, 'execute'>>;
  let deleteTask: jest.Mocked<Pick<DeleteTaskUsecase, 'execute'>>;
  let controller: TaskController;

  beforeEach(() => {
    taskRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findPendingReminders: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    userRepository = {
      save: jest.fn(),
      findByTelegramUserId: jest.fn(),
      findById: jest.fn().mockResolvedValue(owner),
      update: jest.fn(),
    };
    listTasks = { execute: jest.fn() };
    processText = { execute: jest.fn() };
    processVoice = { execute: jest.fn() };
    markComplete = { execute: jest.fn() };
    delayTask = { execute: jest.fn() };
    deleteTask = { execute: jest.fn() };

    controller = new TaskController(
      taskRepository,
      userRepository,
      listTasks as unknown as ListTasksUsecase,
      processText as unknown as ProcessTextMessageUsecase,
      processVoice as unknown as ProcessVoiceMessageUsecase,
      markComplete as unknown as MarkCompleteUsecase,
      delayTask as unknown as DelayTaskUsecase,
      deleteTask as unknown as DeleteTaskUsecase,
    );
  });

  describe('create', () => {
    it('passes user timezone into ProcessTextMessageUsecase', async () => {
      processText.execute.mockResolvedValue({
        taskId: 'task-1',
        description: 'Buy milk',
        scheduledAt: ownedTask.scheduledAt,
      });
      taskRepository.findById.mockResolvedValue(ownedTask);

      const dto = await controller.create(auth, { text: 'buy milk tomorrow 9am' });

      expect(processText.execute).toHaveBeenCalledWith({
        userId: 'owner-1',
        telegramChatId: 42,
        text: 'buy milk tomorrow 9am',
        userTimezone: 'America/New_York',
      });
      expect(dto.id).toBe('task-1');
    });

    it('omits userTimezone when user has none', async () => {
      userRepository.findById.mockResolvedValue({ ...owner, timezone: null });
      processText.execute.mockResolvedValue({
        taskId: 'task-1',
        description: 'Buy milk',
        scheduledAt: ownedTask.scheduledAt,
      });
      taskRepository.findById.mockResolvedValue(ownedTask);

      await controller.create(auth, { text: 'buy milk' });

      expect(processText.execute).toHaveBeenCalledWith({
        userId: 'owner-1',
        telegramChatId: 42,
        text: 'buy milk',
      });
    });
  });

  describe('ownership', () => {
    it('returns 403 when completing a task owned by another user', async () => {
      taskRepository.findById.mockResolvedValue(ownedTask);
      await expect(controller.complete(foreignAuth, 'task-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(markComplete.execute).not.toHaveBeenCalled();
    });

    it('returns 404 when the task does not exist', async () => {
      taskRepository.findById.mockResolvedValue(null);
      await expect(controller.complete(auth, 'missing')).rejects.toBeInstanceOf(
        TaskNotFoundError,
      );
    });

    it('allows completing a task you own', async () => {
      taskRepository.findById.mockResolvedValue(ownedTask);
      markComplete.execute.mockResolvedValue({
        ...ownedTask,
        status: TaskStatus.Completed,
      });

      const dto = await controller.complete(auth, 'task-1');

      expect(markComplete.execute).toHaveBeenCalledWith({ taskId: 'task-1' });
      expect(dto.status).toBe(TaskStatus.Completed);
    });

    it('blocks delay on a task owned by another user', async () => {
      taskRepository.findById.mockResolvedValue(ownedTask);
      await expect(
        controller.delay(foreignAuth, 'task-1', { minutes: 15 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(delayTask.execute).not.toHaveBeenCalled();
    });

    it('blocks delete on a task owned by another user', async () => {
      taskRepository.findById.mockResolvedValue(ownedTask);
      await expect(controller.remove(foreignAuth, 'task-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(deleteTask.execute).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('coerces the includeCompleted query string to a boolean', async () => {
      listTasks.execute.mockResolvedValue({ tasks: [] });

      await controller.list(auth, { includeCompleted: 'true' });
      expect(listTasks.execute).toHaveBeenLastCalledWith({
        userId: 'owner-1',
        includeCompleted: true,
      });

      await controller.list(auth, {});
      expect(listTasks.execute).toHaveBeenLastCalledWith({
        userId: 'owner-1',
        includeCompleted: false,
      });
    });
  });
});
