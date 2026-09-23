import { Inject, Injectable, Logger } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { userZone } from '@common/user-zone';
import { normaliseListName } from '@common/list-name';
import type {
  Interpretation,
  InterpreterGateway,
  TaskDraft,
} from '@domain/assistant';
import { NotATaskError } from '@domain/assistant';
import type { Category, UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { ListCategoriesUsecase } from '../../category/list-categories';
import type { ParseLinesInput, ParseTaskInput, ParsedTaskDraft } from './types';

/** Lines of a list read at the same time. */
const CONCURRENCY = 6;

type Context = {
  timezone: string;
  now: Date;
  categories: Category[];
};

const NOT_A_TASK =
  'That does not look like something to remember. Say what, and when if it has a time, e.g. "call mom tomorrow at 18:00".';
const NOT_A_NEW_TASK =
  'That reads like a change to an existing task, not a new one. Open the task to change it, or say it in the chat.';

/**
 * Text → task drafts, through the same interpreter (strict json_schema,
 * every trust guard in interpret-output.ts) the chat uses. Nothing is
 * saved. Used by the Mini App's Create preview, POST /tasks, voice, and
 * (line by line) the list import.
 *
 * Past or invalid times never become a draft (B6): the interpreter turns
 * them into a question, and here a question, chat or garbage is a
 * NotATaskError (B20) instead of an invented task.
 */
@Injectable()
export class ParseTaskUsecase {
  private readonly logger = new Logger(ParseTaskUsecase.name);

  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Assistant.InterpreterGateway)
    private readonly interpreter: InterpreterGateway,
    private readonly listCategories: ListCategoriesUsecase,
  ) {}

  /** One request: at least one draft, or NotATaskError. */
  public async execute(input: ParseTaskInput): Promise<ParsedTaskDraft[]> {
    const ctx = await this.context(input.userId, input.now);
    const interpretation = await this.interpret(ctx, input.text);
    if (interpretation.intent === 'create') {
      return interpretation.tasks.map((t) => toDraft(t, ctx));
    }
    throw new NotATaskError(notATaskMessage(interpretation));
  }

  /**
   * Each line of a pasted list on its own ("Add this as a task: …"), in
   * order. A line the interpreter can't turn into a task, or that fails,
   * comes back null so the caller can keep it as a plain todo.
   */
  public async executeLines(
    input: ParseLinesInput,
  ): Promise<(ParsedTaskDraft[] | null)[]> {
    if (input.lines.length === 0) return [];
    const ctx = await this.context(input.userId, input.now);
    return mapLimit(input.lines, CONCURRENCY, async (line) => {
      try {
        const interpretation = await this.interpret(
          ctx,
          `Add this as a task: ${line}`,
        );
        if (
          interpretation.intent === 'create' &&
          interpretation.tasks.length > 0
        ) {
          return interpretation.tasks.map((t) => toDraft(t, ctx));
        }
      } catch (error) {
        this.logger.warn(`List line kept as a todo: ${String(error)}`);
      }
      return null;
    });
  }

  private async context(userId: string, now?: Date): Promise<Context> {
    const user = await this.users.findById(userId);
    if (!user) throw new UserNotFoundError(`User ${userId} not found`);
    return {
      timezone: userZone(user),
      now: now ?? new Date(),
      categories: await this.listCategories.execute({ userId: user.id }),
    };
  }

  private interpret(ctx: Context, text: string): Promise<Interpretation> {
    return this.interpreter.interpret({
      text,
      timezone: ctx.timezone,
      now: ctx.now,
      // A new task: nothing to resolve "it" or "the dentist" against.
      candidates: [],
      categories: ctx.categories.map((c) => c.name),
      replyToTaskIds: [],
      lastTaskIds: [],
      pendingQuestion: null,
      quoted: null,
    });
  }
}

function toDraft(draft: TaskDraft, ctx: Context): ParsedTaskDraft {
  const wanted = draft.categoryName?.toLowerCase();
  const timed = draft.dueAt !== null;
  return {
    description: draft.title.slice(0, 4000),
    notes: draft.notes,
    scheduledAt: draft.dueAt,
    allDay: timed && draft.allDay === true,
    // No time: no repeat and no heads-up, whatever the model said.
    recurrence: timed ? draft.recurrence : null,
    priority: draft.priority,
    categoryId: wanted
      ? (ctx.categories.find((c) => c.name.toLowerCase() === wanted)?.id ??
        null)
      : null,
    leadMinutes: timed ? draft.leadMinutes : null,
    list: normaliseListName(draft.list),
  };
}

function notATaskMessage(interpretation: Interpretation): string {
  switch (interpretation.intent) {
    // The interpreter's own question: "that time has already passed…",
    // "when exactly…", "what should I remind you about?".
    case 'unclear':
      return interpretation.question;
    case 'chat':
      return NOT_A_TASK;
    case 'query':
      return NOT_A_TASK;
    default:
      return NOT_A_NEW_TASK;
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
