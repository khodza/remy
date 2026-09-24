import { ShowTaskSourceUsecase } from './usecase';
import type { NotificationGateway } from '@domain/notification';
import { NoSourceMessageError, TaskNotFoundError } from '@domain/task/errors';
import { makeTask, mockTaskRepository } from '@test/factories';

describe('ShowTaskSourceUsecase', () => {
  const notifications = {
    sendSourceLink: jest.fn().mockResolvedValue({ messageId: 99 }),
  } as unknown as jest.Mocked<NotificationGateway>;

  it('replies to the message the task came from, in its chat', async () => {
    const tasks = mockTaskRepository();
    tasks.findById.mockResolvedValue(
      makeTask({
        telegramChatId: 42,
        description: 'Dentist',
        source: {
          type: 'forward',
          originalText: 'x',
          messageId: 7,
          forwardedFrom: 'Clinic',
        },
      }),
    );
    await expect(
      new ShowTaskSourceUsecase(tasks, notifications).execute({
        taskId: 'task-1',
      }),
    ).resolves.toEqual({ messageId: 99 });
    expect(notifications.sendSourceLink).toHaveBeenCalledWith({
      chatId: 42,
      replyToMessageId: 7,
      description: 'Dentist',
    });
  });

  it('a task made in the Mini App has no source message; a missing task 404s', async () => {
    const tasks = mockTaskRepository();
    tasks.findById.mockResolvedValue(makeTask());
    const usecase = new ShowTaskSourceUsecase(tasks, notifications);
    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toBeInstanceOf(
      NoSourceMessageError,
    );
    tasks.findById.mockResolvedValue(null);
    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });
});
