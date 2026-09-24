import { Inject, Injectable } from '@nestjs/common';
import { addDays, addMinutes } from 'date-fns';
import type {
  InterpreterGateway,
  Interpretation,
  TaskDraft,
} from '@domain/assistant';
import type { ConversationRepository } from '@domain/conversation';
import {
  type Task,
  type TaskRepository,
  TaskStatus,
} from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { dayBoundsInZone } from '@common/day-bounds';
import { effectiveDueAt } from '@common/fire-time';
import { ListCategoriesUsecase } from '../../category/list-categories';
import { MarkCompleteUsecase } from '../../task/mark-complete';
import { DeleteTaskUsecase } from '../../task/delete-task';
import { SnoozeTaskUsecase } from '../../task/snooze-task';
import { UpdateTaskUsecase } from '../../task/update-task';
import { UndoRecorder } from '../undo-recorder';
import type { AssistantResult, HandleMessageInput } from './types';

/**
 * The model sees at most this many dated tasks plus this many todos. Two
 * separate queries: sorted together, Mongo puts undated todos first, so a
 * long Inbox would push every dated task out of a single limited query.
 */
const MAX_DATED_CANDIDATES = 45;
const MAX_TODO_CANDIDATES = 15;
const PENDING_QUESTION_TTL_MINUTES = 5;
/**
 * Questions Remy may ask in a row about one request. Past this the model is
 * going in circles; starting over beats a fourth question.
 */
const MAX_QUESTION_ROUNDS = 3;
const GIVE_UP_REPLY =
  'Sorry, I keep missing it. Nothing was saved. Please say the whole thing again in one message, for example: “call my brother tomorrow at 17:00”.';
const PENDING_FORWARD_TTL_MINUTES = 15;
const QUOTED_NOTES_MAX = 1000;

/**
 * One chat message in, one action out. The interpreter decides what the
 * user meant; this use case does it, records how to undo it, and keeps the
 * small amount of conversational memory ("it", a pending question, a
 * forwarded message waiting for a time).
 */
@Injectable()
export class HandleMessageUsecase {
  constructor(
    @Inject(Domain.Assistant.InterpreterGateway)
    private readonly interpreter: InterpreterGateway,
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
    private readonly listCategories: ListCategoriesUsecase,
    private readonly markComplete: MarkCompleteUsecase,
    private readonly deleteTask: DeleteTaskUsecase,
    private readonly snoozeTask: SnoozeTaskUsecase,
    private readonly updateTask: UpdateTaskUsecase,
    private readonly undo: UndoRecorder,
  ) {}

  /** A forwarded message arrived on its own: keep it until the user says when. */
  public async captureForward(input: {
    chatId: number;
    text: string;
    forwardedFrom: string | null;
    messageId: number;
  }): Promise<void> {
    await this.conversations.setPendingForward(input.chatId, {
      text: input.text,
      forwardedFrom: input.forwardedFrom,
      messageId: input.messageId,
      receivedAt: new Date(),
    });
  }

  /** Remember which tasks a bot message is about, so replies to it work. */
  public async linkReply(
    chatId: number,
    messageId: number,
    taskIds: string[],
    kind: 'confirmation' | 'agenda',
  ): Promise<void> {
    await this.conversations.linkMessage({ chatId, messageId, taskIds, kind });
  }

  public async execute(input: HandleMessageInput): Promise<AssistantResult> {
    const now = new Date();
    const [state, dated, todos, categories, replyToTaskIds] = await Promise.all(
      [
        this.conversations.getState(input.chatId),
        this.tasks.find({
          userId: input.userId,
          statuses: [TaskStatus.Pending],
          kind: 'reminder',
          sort: 'dueAt',
          limit: MAX_DATED_CANDIDATES,
        }),
        this.tasks.find({
          userId: input.userId,
          statuses: [TaskStatus.Pending],
          kind: 'todo',
          sort: 'createdAtDesc',
          limit: MAX_TODO_CANDIDATES,
        }),
        this.listCategories.execute({ userId: input.userId }),
        input.replyToMessageId !== undefined
          ? this.conversations.findLinkedTaskIds(
              input.chatId,
              input.replyToMessageId,
            )
          : Promise.resolve([]),
      ],
    );

    // A tapped answer names its question, so it is never "too late" for it.
    const pendingQuestion =
      state.pendingQuestion &&
      (input.answersPendingQuestion === true ||
        isFresh(
          state.pendingQuestion.askedAt,
          now,
          PENDING_QUESTION_TTL_MINUTES,
        ))
        ? state.pendingQuestion
        : null;
    const pendingForward =
      state.pendingForward &&
      isFresh(state.pendingForward.receivedAt, now, PENDING_FORWARD_TTL_MINUTES)
        ? state.pendingForward
        : null;
    const quoted =
      input.quoted ??
      (pendingForward
        ? { text: pendingForward.text, from: pendingForward.forwardedFrom }
        : null);

    // Todos sort first in Mongo (null fire time); dated tasks are what people
    // usually refer to, so put them first in the list the model sees.
    // When the user replies to a numbered list (an agenda, a multi-create
    // confirmation), those tasks lead in the same order, so "done with 2"
    // means the 2 they are looking at.
    const open = [
      ...new Map([...dated, ...todos].map((t) => [t.id, t])).values(),
    ];
    const sorted = open.sort(byDueThenTodo);
    const linked = replyToTaskIds
      .map((id) => sorted.find((t) => t.id === id))
      .filter((t): t is Task => t !== undefined);
    const candidates = [
      ...linked,
      ...sorted.filter((t) => !linked.includes(t)),
    ];

    const interpretation = await this.interpreter.interpret({
      text: input.text,
      timezone: input.timezone,
      now,
      candidates: candidates.map((t) => ({
        id: t.id,
        title: t.description,
        dueAt: effectiveDueAt(t),
        recurring: t.recurrence !== null,
      })),
      categories: categories.map((c) => c.name),
      replyToTaskIds,
      lastTaskIds: state.lastTaskIds,
      pendingQuestion: pendingQuestion
        ? {
            originalText: pendingQuestion.originalText,
            question: pendingQuestion.question,
            answered: pendingQuestion.answered ?? [],
          }
        : null,
      quoted,
    });

    let result = await this.act(
      interpretation,
      input,
      candidates,
      categories,
      quoted,
      now,
    );

    // Conversation memory.
    const answered = pendingQuestion
      ? [
          ...(pendingQuestion.answered ?? []),
          { question: pendingQuestion.question, answer: input.text },
        ]
      : [];
    if (result.kind === 'question' && answered.length >= MAX_QUESTION_ROUNDS) {
      result = { kind: 'chat', reply: GIVE_UP_REPLY };
    }
    if (result.kind === 'question') {
      await this.conversations.setPendingQuestion(input.chatId, {
        // Keep the first message of the exchange as the thing being clarified.
        originalText: pendingQuestion?.originalText ?? input.text,
        question: result.question,
        options: result.options,
        askedAt: now,
        answered,
      });
    } else {
      if (state.pendingQuestion)
        await this.conversations.setPendingQuestion(input.chatId, null);
      if (state.pendingForward && result.kind === 'created') {
        await this.conversations.setPendingForward(input.chatId, null);
      }
    }
    const touched = touchedIds(result);
    if (touched.length > 0)
      await this.conversations.setLastTaskIds(input.chatId, touched);

    return result;
  }

  private async act(
    interpretation: Interpretation,
    input: HandleMessageInput,
    candidates: Task[],
    categories: { id: string; name: string }[],
    quoted: { text: string; from: string | null } | null,
    now: Date,
  ): Promise<AssistantResult> {
    const byId = new Map(candidates.map((t) => [t.id, t]));
    const pick = (ids: string[]): Task[] =>
      ids.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined);

    switch (interpretation.intent) {
      case 'chat':
        return { kind: 'chat', reply: interpretation.reply };

      case 'unclear':
        return {
          kind: 'question',
          question: interpretation.question,
          options: interpretation.options,
        };

      case 'create': {
        const created: Task[] = [];
        for (const draft of interpretation.tasks) {
          created.push(
            await this.createFromDraft(draft, input, categories, quoted),
          );
        }
        const undoId = await this.undo.record({
          chatId: input.chatId,
          userId: input.userId,
          label:
            created.length === 1
              ? `created "${created[0]!.description}"`
              : `created ${created.length} tasks`,
          createdTaskIds: created.map((t) => t.id),
        });
        return { kind: 'created', tasks: created, undoId };
      }

      case 'query':
        return {
          kind: 'agenda',
          range: interpretation.range,
          search: interpretation.search,
          tasks: await this.query(
            input,
            interpretation.range,
            interpretation.search,
            now,
          ),
        };

      case 'complete': {
        const before = pick(interpretation.targetIds);
        if (before.length === 0) return askWhich('Which task did you finish?');
        const undoId = await this.recordBefore(input, before, 'completed');
        const after: Task[] = [];
        for (const task of before) {
          // "already took my pills" half an hour early means today's dose.
          const early =
            task.recurrence !== null &&
            task.scheduledAt !== null &&
            task.scheduledAt.getTime() > now.getTime() &&
            task.scheduledAt.getTime() < addDays(now, 1).getTime();
          after.push(
            await this.markComplete.execute({
              taskId: task.id,
              ...(early && task.scheduledAt
                ? { occurrenceAt: task.scheduledAt }
                : {}),
            }),
          );
        }
        return { kind: 'completed', tasks: after, undoId };
      }

      case 'delete': {
        const before = pick(interpretation.targetIds);
        if (before.length === 0) return askWhich('Which task should I delete?');
        const undoId = await this.recordBefore(input, before, 'deleted');
        for (const task of before)
          await this.deleteTask.execute({ taskId: task.id });
        return { kind: 'deleted', tasks: before, undoId };
      }

      case 'edit': {
        const [task] = pick([interpretation.targetId]);
        if (!task) return askWhich('Which task should I change?');
        const undoId = await this.recordBefore(input, [task], 'edited');
        const updated = await this.updateTask.execute({
          taskId: task.id,
          ...(interpretation.title !== null
            ? { description: interpretation.title }
            : {}),
          ...(interpretation.notes !== null
            ? { notes: interpretation.notes }
            : {}),
        });
        return { kind: 'edited', task: updated, undoId };
      }

      case 'reschedule': {
        const targets = pick(interpretation.targetIds);
        if (targets.length === 0) return askWhich('Which task should I move?');

        const plan = targets.map((task) => ({
          task,
          newTime: newTimeFor(
            task,
            interpretation.dueAt,
            interpretation.shiftMinutes,
          ),
        }));
        const movable = plan.filter(
          (p): p is { task: Task; newTime: Date } =>
            p.newTime !== null && p.newTime.getTime() > now.getTime(),
        );
        const skipped = plan
          .filter((p) => !movable.some((m) => m.task.id === p.task.id))
          .map((p) => p.task);
        if (movable.length === 0) {
          return { kind: 'rescheduled', tasks: [], skipped, undoId: null };
        }

        const undoId = await this.recordBefore(
          input,
          movable.map((m) => m.task),
          'moved',
        );
        const moved: Task[] = [];
        for (const { task, newTime } of movable) {
          moved.push(
            task.scheduledAt === null
              ? // A todo gets its first time.
                await this.updateTask.execute({
                  taskId: task.id,
                  scheduledAt: newTime,
                })
              : // A reminder moves; a recurring one only for this occurrence.
                await this.snoozeTask.execute({
                  taskId: task.id,
                  until: newTime,
                }),
          );
        }
        return { kind: 'rescheduled', tasks: moved, skipped, undoId };
      }
    }
  }

  private async createFromDraft(
    draft: TaskDraft,
    input: HandleMessageInput,
    categories: { id: string; name: string }[],
    quoted: { text: string; from: string | null } | null,
  ): Promise<Task> {
    const categoryId = draft.categoryName
      ? (categories.find((c) => c.name === draft.categoryName)?.id ?? null)
      : null;
    // A forwarded message is the "why" of the reminder: keep it in the notes.
    const quotedText = quoted ? quoted.text.slice(0, QUOTED_NOTES_MAX) : null;
    const notes =
      [draft.notes, quotedText].filter(Boolean).join('\n\n') || null;
    return this.tasks.create({
      userId: input.userId,
      telegramChatId: input.chatId,
      description: draft.title,
      notes,
      scheduledAt: draft.dueAt,
      timezone: input.timezone,
      allDay: draft.allDay === true && draft.dueAt !== null,
      recurrence:
        draft.recurrence && draft.dueAt
          ? { ...draft.recurrence, anchorAt: draft.dueAt }
          : null,
      priority: draft.priority,
      categoryId,
      leadMinutes: draft.dueAt ? draft.leadMinutes : null,
      source: {
        type: quoted ? 'forward' : input.source.type,
        originalText: input.text,
        messageId: input.source.messageId ?? null,
        forwardedFrom: quoted?.from ?? null,
      },
    });
  }

  private async query(
    input: HandleMessageInput,
    range: Extract<Interpretation, { intent: 'query' }>['range'],
    search: string | null,
    now: Date,
  ): Promise<Task[]> {
    const { end } = dayBoundsInZone(now, input.timezone);
    const endOfToday = new Date(end.getTime() - 1);
    const pending = [TaskStatus.Pending];
    const base = {
      userId: input.userId,
      statuses: pending,
      sort: 'dueAt' as const,
    };

    let tasks: Task[];
    switch (range) {
      case 'today':
        tasks = await this.tasks.find({
          ...base,
          kind: 'reminder',
          dueAtOrBefore: endOfToday,
        });
        break;
      case 'tomorrow':
        tasks = await this.tasks.find({
          ...base,
          kind: 'reminder',
          dueAfter: endOfToday,
          dueAtOrBefore: addDays(endOfToday, 1),
        });
        break;
      case 'week':
        tasks = await this.tasks.find({
          ...base,
          kind: 'reminder',
          dueAtOrBefore: addDays(endOfToday, 7),
        });
        break;
      case 'overdue':
        tasks = await this.tasks.find({
          ...base,
          kind: 'reminder',
          dueAtOrBefore: now,
        });
        break;
      case 'inbox':
        tasks = await this.tasks.find({
          ...base,
          kind: 'todo',
          sort: 'createdAtDesc',
        });
        break;
      case 'all':
        tasks = (await this.tasks.find(base)).sort(byDueThenTodo);
        break;
    }
    if (range === 'overdue') {
      // nextFireAt may be a pending heads-up; overdue means the due time passed.
      tasks = tasks.filter(
        (t) => (effectiveDueAt(t)?.getTime() ?? Infinity) < now.getTime(),
      );
    }
    if (search) {
      const needle = search.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.description.toLowerCase().includes(needle) ||
          (t.notes ?? '').toLowerCase().includes(needle),
      );
    }
    return tasks;
  }

  private recordBefore(
    input: HandleMessageInput,
    before: Task[],
    verb: string,
  ): Promise<string> {
    return this.undo.record({
      chatId: input.chatId,
      userId: input.userId,
      label:
        before.length === 1
          ? `${verb} "${before[0]!.description}"`
          : `${verb} ${before.length} tasks`,
      before,
    });
  }
}

function askWhich(question: string): AssistantResult {
  return { kind: 'question', question, options: [] };
}

function isFresh(since: Date, now: Date, minutes: number): boolean {
  return addMinutes(since, minutes).getTime() > now.getTime();
}

function byDueThenTodo(a: Task, b: Task): number {
  const da = effectiveDueAt(a)?.getTime() ?? Infinity;
  const db = effectiveDueAt(b)?.getTime() ?? Infinity;
  return da - db;
}

/** Absolute time applies to every target; a shift keeps each task's time of day. */
function newTimeFor(
  task: Task,
  dueAt: Date | null,
  shiftMinutes: number | null,
): Date | null {
  if (dueAt) return dueAt;
  const current = effectiveDueAt(task);
  if (shiftMinutes === null || current === null) return null;
  return addMinutes(current, shiftMinutes);
}

function touchedIds(result: AssistantResult): string[] {
  switch (result.kind) {
    case 'created':
    case 'completed':
    case 'rescheduled':
      return result.tasks.map((t) => t.id);
    case 'edited':
      return [result.task.id];
    default:
      return [];
  }
}
