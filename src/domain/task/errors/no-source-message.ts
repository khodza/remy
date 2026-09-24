import { ApplicationError } from '@domain/error';

/** The task was not made from a chat message (Mini App, import). */
export class NoSourceMessageError extends ApplicationError {}
