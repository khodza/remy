import { Injectable } from '@nestjs/common';
import { validateText } from '@common/validation';
import type { Task } from '@domain/task';
import { ParseTaskUsecase } from '../parse-task';
import { CreateStructuredTaskUsecase } from '../create-structured-task';
import { ProcessTextMessageInput, ProcessTextMessageOutput } from './types';

/**
 * Natural language straight to saved tasks (the Mini App's POST /tasks and
 * voice). Reads the text exactly like the Create preview does
 * (ParseTaskUsecase), so a past time, chat or garbage is a NotATaskError and
 * nothing is saved; then saves every draft as if the user had reviewed it.
 */
@Injectable()
export class ProcessTextMessageUsecase {
  constructor(
    private readonly parseTask: ParseTaskUsecase,
    private readonly createStructured: CreateStructuredTaskUsecase,
  ) {}

  public async execute(
    input: ProcessTextMessageInput,
  ): Promise<ProcessTextMessageOutput> {
    validateText(input.text);
    const drafts = await this.parseTask.execute({
      userId: input.userId,
      text: input.text,
      ...(input.now ? { now: input.now } : {}),
    });
    const tasks: Task[] = [];
    for (const draft of drafts) {
      tasks.push(
        await this.createStructured.execute({
          ...draft,
          userId: input.userId,
          telegramChatId: input.telegramChatId,
          timezone: input.timezone,
          originalText: input.text,
          sourceType: input.sourceType ?? 'miniapp',
        }),
      );
    }
    return { tasks };
  }
}
