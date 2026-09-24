import { ApplicationError } from '@domain/error';

/** The chat message a task came from was deleted; nothing to reply to. */
export class SourceMessageGoneError extends ApplicationError {}
