import { Inject, Injectable, Logger } from '@nestjs/common';
import { Domain } from '@common/tokens';
import type { InterpreterGateway, TaskDraft } from '@domain/assistant';
import type { Priority, Recurrence } from '@domain/task';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { ListCategoriesUsecase } from '../../category/list-categories';
import { userZone } from '../zone';
import { splitList } from './split-list';

export const IMPORT_MAX_TASKS = 50;
/** Lines read at the same time. */
const CONCURRENCY = 6;

export type ParseListInput = { userId: string; text: string; now?: Date };

export type ImportDraft = {
  description: string;
  notes: string | null;
  /** Null = no time given → a todo in the Inbox. */
  scheduledAt: Date | null;
  recurrence: Omit<Recurrence, 'anchorAt'> | null;
  priority: Priority;
  categoryId: string | null;
  leadMinutes: number | null;
};

/**
 * A pasted list → drafts for the user to review; nothing is saved here.
 * The assistant reads each line on its own (so "dentist tomorrow 10" gets
 * its time and undated lines become todos) and every trust rule of the
 * chat applies. One call per line, not one for the list: given five lines
 * at once, gpt-4o-mini dropped "at 11" from "call mom every sunday at 11"
 * (and the guard then dropped the repeat), while every line alone came out
 * right. A line the assistant can't read becomes a todo, which the review
 * screen shows, instead of an error.
 */
@Injectable()
export class ParseListUsecase {
  private readonly logger = new Logger(ParseListUsecase.name);

  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Assistant.InterpreterGateway)
    private readonly interpreter: InterpreterGateway,
    private readonly listCategories: ListCategoriesUsecase,
  ) {}

  public async execute(input: ParseListInput): Promise<ImportDraft[]> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);
    const lines = splitList(input.text, IMPORT_MAX_TASKS);
    if (lines.length === 0) return [];

    const categories = await this.listCategories.execute({ userId: user.id });
    const categoryId = (name: string | null) =>
      name
        ? (categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
            ?.id ?? null)
        : null;
    const todo = (line: string): ImportDraft => ({
      description: line.slice(0, 4000),
      notes: null,
      scheduledAt: null,
      recurrence: null,
      priority: 'normal',
      categoryId: null,
      leadMinutes: null,
    });
    const fromDraft = (draft: TaskDraft): ImportDraft => ({
      description: draft.title,
      notes: draft.notes,
      scheduledAt: draft.dueAt,
      recurrence: draft.dueAt ? draft.recurrence : null,
      priority: draft.priority,
      categoryId: categoryId(draft.categoryName),
      leadMinutes: draft.dueAt ? draft.leadMinutes : null,
    });
    const timezone = userZone(user);
    const now = input.now ?? new Date();
    const names = categories.map((c) => c.name);

    const perLine = await mapLimit(lines, CONCURRENCY, async (line) => {
      try {
        const interpretation = await this.interpreter.interpret({
          text: `Add this as a task: ${line}`,
          timezone,
          now,
          candidates: [],
          categories: names,
          replyToTaskIds: [],
          lastTaskIds: [],
          pendingQuestion: null,
          quoted: null,
        });
        if (
          interpretation.intent === 'create' &&
          interpretation.tasks.length > 0
        ) {
          return interpretation.tasks.map(fromDraft);
        }
      } catch (error) {
        this.logger.warn(`Import line kept as a todo: ${String(error)}`);
      }
      return [todo(line)];
    });
    // A line can hold several tasks ("milk, and call mom at 5").
    return perLine.flat().slice(0, IMPORT_MAX_TASKS);
  }
}

/** Like Promise.all over `items`, at most `limit` at a time, order kept. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
