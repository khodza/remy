import { ApplicationError } from '@domain/error';

export class InterpretationFailedError extends ApplicationError {}

/**
 * The text asked for no new task: chat, garbage (a bad transcript), a
 * question, or a request that needs clarifying (a time that already
 * passed, no time where one was named). `message` is safe to show.
 */
export class NotATaskError extends ApplicationError {}
