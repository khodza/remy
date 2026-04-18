import { Injectable, Inject } from '@nestjs/common';
import type { TaskRepository } from '@domain/task/repository';
import type { TaskParserGateway } from '@domain/ai/gateway/task-parser';
import { Domain } from '@common/tokens';
import { ProcessTextMessageInput, ProcessTextMessageOutput } from './types';
import { ApplicationError } from '@domain/error';
import { FailedToCreateTaskError } from '@domain/task/errors';
import { validateText } from '@common/validation';

@Injectable()
export class ProcessTextMessageUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    @Inject(Domain.AI.TaskParserGateway)
    private readonly taskParserGateway: TaskParserGateway,
  ) {}

  public async execute(
    input: ProcessTextMessageInput,
  ): Promise<ProcessTextMessageOutput> {
    try {
      // Validate input text
      validateText(input.text);

      // Parse task from text using AI
      const parsed = await this.taskParserGateway.parse({
        text: input.text,
        userTimezone: input.userTimezone,
      });

      // Create task
      const task = await this.taskRepository.create({
        userId: input.userId,
        telegramChatId: input.telegramChatId,
        description: parsed.description,
        scheduledAt: parsed.scheduledAt,
        recurrence: parsed.recurrence,
      });

      return {
        taskId: task.id,
        description: task.description,
        scheduledAt: task.scheduledAt,
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToCreateTaskError(
        'Failed to process text message',
        error,
      );
    }
  }
}
