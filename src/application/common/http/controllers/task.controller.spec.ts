import { ForbiddenException } from '@nestjs/common';
import type { TaskRepository } from '@domain/task';
import { TaskNotFoundError, TaskStatus } from '@domain/task';
import type { UserRepository } from '@domain/user';
import type {
  CreateStructuredTaskUsecase,
  DelayTaskUsecase,
  DeleteTaskUsecase,
  ListTasksUsecase,
  MarkCompleteUsecase,
  ProcessTextMessageUsecase,
  ProcessVoiceMessageUsecase,
  ReopenTaskUsecase,
  SnoozeTaskUsecase,
  UpdateTaskUsecase,
} from '@usecases/task';
import { wire } from '@contract/remy-contract';
import { TaskController } from './task.controller';
import type { AuthContext } from '../types';
import { makeTask, makeUser, mockTaskRepository } from '@test/factories';

type Exec<T extends { execute: (...args: never[]) => unknown }> = jest.Mocked<
  Pick<T, 'execute'>
>;

describe('TaskController', () => {
  const auth: AuthContext = { userId: 'owner-1', telegramUserId: 42 };
  const foreignAuth: AuthContext = { userId: 'intruder', telegramUserId: 99 };
  const id = '64b64c1f9f1b2c3d4e5f6a7b';

  const ownedTask = makeTask({
    id,
    userId: 'owner-1',
    telegramChatId: 42,
    description: 'Buy milk',
    scheduledAt: new Date('2026-04-19T09:00:00Z'),
    timezone: 'America/New_York',
  });
  const owner = makeUser({ id: 'owner-1', timezone: 'America/New_York' });

  let taskRepository: jest.Mocked<TaskRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let listTasks: Exec<ListTasksUsecase>;
  let processText: Exec<ProcessTextMessageUsecase>;
  let processVoice: Exec<ProcessVoiceMessageUsecase>;
  let createStructured: Exec<CreateStructuredTaskUsecase>;
  let updateTask: Exec<UpdateTaskUsecase>;
  let markComplete: Exec<MarkCompleteUsecase>;
  let reopenTask: Exec<ReopenTaskUsecase>;
  let delayTask: Exec<DelayTaskUsecase>;
  let snoozeTask: Exec<SnoozeTaskUsecase>;
  let deleteTask: Exec<DeleteTaskUsecase>;
  let controller: TaskController;

  beforeEach(() => {
    taskRepository = mockTaskRepository();
    userRepository = {
      save: jest.fn(),
      findByTelegramUserId: jest.fn(),
      findById: jest.fn().mockResolvedValue(owner),
      update: jest.fn(),
    };
    listTasks = { execute: jest.fn() };
    processText = { execute: jest.fn() };
    processVoice = { execute: jest.fn() };
    createStructured = { execute: jest.fn() };
    updateTask = { execute: jest.fn() };
    markComplete = { execute: jest.fn() };
    reopenTask = { execute: jest.fn() };
    delayTask = { execute: jest.fn() };
    snoozeTask = { execute: jest.fn() };
    deleteTask = { execute: jest.fn() };

    controller = new TaskController(
      taskRepository,
      userRepository,
      listTasks as unknown as ListTasksUsecase,
      processText as unknown as ProcessTextMessageUsecase,
      processVoice as unknown as ProcessVoiceMessageUsecase,
      createStructured as unknown as CreateStructuredTaskUsecase,
      updateTask as unknown as UpdateTaskUsecase,
      markComplete as unknown as MarkCompleteUsecase,
      reopenTask as unknown as ReopenTaskUsecase,
      delayTask as unknown as DelayTaskUsecase,
      snoozeTask as unknown as SnoozeTaskUsecase,
      deleteTask as unknown as DeleteTaskUsecase,
    );
  });

  describe('responses follow the contract', () => {
    it('GET /tasks/:id returns a wire.Task', async () => {
      taskRepository.findById.mockResolvedValue(ownedTask);
      const dto = await controller.getOne(auth, id);
      expect(() => wire.Task.parse(dto)).not.toThrow();
      expect(dto).toMatchObject({
        id,
        kind: 'reminder',
        timezone: 'America/New_York',
        scheduledAt: '2026-04-19T09:00:00.000Z',
        nextFireAt: '2026-04-19T09:00:00.000Z',
        priority: 'normal',
        completionsCount: 0,
      });
    });

    it('a todo serialises with null times and is never overdue', async () => {
      taskRepository.findById.mockResolvedValue(
        makeTask({ id, userId: 'owner-1', scheduledAt: null }),
      );
      const dto = await controller.getOne(auth, id);
      expect(() => wire.Task.parse(dto)).not.toThrow();
      expect(dto).toMatchObject({
        kind: 'todo',
        scheduledAt: null,
        nextFireAt: null,
        isOverdue: false,
      });
    });

    it('GET /tasks returns a wire.TaskList and forwards the view + user zone', async () => {
      listTasks.execute.mockResolvedValue({
        tasks: [{ ...ownedTask, isOverdue: false }],
      });
      const body = await controller.list(auth, { view: 'today', limit: 10 });
      expect(() => wire.TaskList.parse(body)).not.toThrow();
      expect(listTasks.execute).toHaveBeenCalledWith({
        userId: 'owner-1',
        view: 'today',
        includeCompleted: false,
        timezone: 'America/New_York',
        limit: 10,
      });
    });
  });

  describe('create', () => {
    it('passes user timezone and the miniapp source into ProcessTextMessageUsecase', async () => {
      processText.execute.mockResolvedValue({
        taskId: id,
        description: 'Buy milk',
        scheduledAt: ownedTask.scheduledAt!,
        timezone: 'America/New_York',
        recurrence: null,
      });
      taskRepository.findById.mockResolvedValue(ownedTask);

      const dto = await controller.create(auth, {
        text: 'buy milk tomorrow 9am',
      });

      expect(processText.execute).toHaveBeenCalledWith({
        userId: 'owner-1',
        telegramChatId: 42,
        text: 'buy milk tomorrow 9am',
        userTimezone: 'America/New_York',
        source: { type: 'miniapp' },
      });
      expect(dto.id).toBe(id);
    });

    it('falls back to UTC when neither the user nor the owner has a zone', async () => {
      userRepository.findById.mockResolvedValue({ ...owner, timezone: null });
      processText.execute.mockResolvedValue({
        taskId: id,
        description: 'Buy milk',
        scheduledAt: ownedTask.scheduledAt!,
        timezone: 'UTC',
        recurrence: null,
      });
      taskRepository.findById.mockResolvedValue(ownedTask);

      await controller.create(auth, { text: 'buy milk' });

      expect(processText.execute).toHaveBeenCalledWith(
        expect.objectContaining({ userTimezone: 'UTC' }),
      );
    });

    it('structured create maps null/absent scheduledAt to a todo', async () => {
      createStructured.execute.mockResolvedValue(
        makeTask({ id, userId: 'owner-1', scheduledAt: null }),
      );
      await controller.createStructured(auth, { description: 'Learn plov' });
      expect(createStructured.execute).toHaveBeenCalledWith({
        userId: 'owner-1',
        telegramChatId: 42,
        timezone: 'America/New_York',
        description: 'Learn plov',
        scheduledAt: null,
      });
    });
  });

  describe('ownership', () => {
    it('blocks update on a task owned by another user', async () => {
      taskRepository.findById.mockResolvedValue(ownedTask);
      await expect(
        controller.update(foreignAuth, id, { description: 'hacked' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(updateTask.execute).not.toHaveBeenCalled();
    });

    it('404s when the task does not exist or is deleted', async () => {
      taskRepository.findById.mockResolvedValue(null);
      await expect(controller.complete(auth, id)).rejects.toBeInstanceOf(
        TaskNotFoundError,
      );
      taskRepository.findById.mockResolvedValue(
        makeTask({ id, userId: 'owner-1', status: TaskStatus.Deleted }),
      );
      await expect(controller.getOne(auth, id)).rejects.toBeInstanceOf(
        TaskNotFoundError,
      );
    });

    it.each([
      ['delay', () => controller.delay(foreignAuth, id, { minutes: 15 })],
      [
        'snooze',
        () =>
          controller.snooze(foreignAuth, id, {
            until: '2030-01-01T00:00:00.000Z',
          }),
      ],
      ['reopen', () => controller.reopen(foreignAuth, id)],
      ['delete', () => controller.remove(foreignAuth, id)],
    ])('blocks %s on a task owned by another user', async (_name, call) => {
      taskRepository.findById.mockResolvedValue(ownedTask);
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('actions', () => {
    beforeEach(() => taskRepository.findById.mockResolvedValue(ownedTask));

    it('completes a task you own', async () => {
      markComplete.execute.mockResolvedValue({
        ...ownedTask,
        status: TaskStatus.Completed,
        completedAt: new Date(),
        alreadyDone: false,
      });
      const dto = await controller.complete(auth, id);
      expect(markComplete.execute).toHaveBeenCalledWith({ taskId: id });
      expect(dto.status).toBe(TaskStatus.Completed);
      expect(() => wire.Task.parse(dto)).not.toThrow();
    });

    it('update forwards only the fields that were sent, null included', async () => {
      updateTask.execute.mockResolvedValue(ownedTask);
      await controller.update(auth, id, {
        notes: null,
        scheduledAt: null,
        priority: 'high',
      });
      expect(updateTask.execute).toHaveBeenCalledWith({
        taskId: id,
        notes: null,
        scheduledAt: null,
        priority: 'high',
      });
    });

    it('snooze converts the ISO string to a Date', async () => {
      snoozeTask.execute.mockResolvedValue(ownedTask);
      await controller.snooze(auth, id, { until: '2030-01-01T20:00:00.000Z' });
      expect(snoozeTask.execute).toHaveBeenCalledWith({
        taskId: id,
        until: new Date('2030-01-01T20:00:00.000Z'),
      });
    });

    it('delete returns the contract DeleteResult', async () => {
      deleteTask.execute.mockResolvedValue({ success: true });
      await expect(controller.remove(auth, id)).resolves.toEqual({
        success: true,
      });
    });
  });
});
