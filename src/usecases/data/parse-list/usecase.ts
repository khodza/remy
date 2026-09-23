import { Injectable } from '@nestjs/common';
import { ParseTaskUsecase, type ParsedTaskDraft } from '../../task/parse-task';
import { splitList } from './split-list';

export const IMPORT_MAX_TASKS = 50;

export type ParseListInput = { userId: string; text: string; now?: Date };

/** One reviewable row of an import (same shape as POST /ai/parse). */
export type ImportDraft = ParsedTaskDraft;

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
  constructor(private readonly parseTask: ParseTaskUsecase) {}

  public async execute(input: ParseListInput): Promise<ImportDraft[]> {
    const lines = splitList(input.text, IMPORT_MAX_TASKS);
    const perLine = await this.parseTask.executeLines({
      userId: input.userId,
      lines,
      ...(input.now ? { now: input.now } : {}),
    });
    // A line can hold several tasks ("milk, and call mom at 5").
    return perLine
      .flatMap((drafts, i) => drafts ?? [todo(lines[i]!)])
      .slice(0, IMPORT_MAX_TASKS);
  }
}

function todo(line: string): ImportDraft {
  return {
    description: line.slice(0, 4000),
    notes: null,
    scheduledAt: null,
    allDay: false,
    recurrence: null,
    priority: 'normal',
    categoryId: null,
    leadMinutes: null,
    list: null,
  };
}
