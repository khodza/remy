import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { InvalidInputError } from '@common/errors';
import {
  FailedToCreateTaskError,
  FailedToUpdateTaskError,
  NoSourceMessageError,
  TaskNotFoundError,
} from '@domain/task';
import { FailedToSaveUserError, UserNotFoundError } from '@domain/user';
import {
  NotificationFailedError,
  SourceMessageGoneError,
} from '@domain/notification/errors';
import { TranscriptionFailedError } from '@domain/ai';
import { InterpretationFailedError, NotATaskError } from '@domain/assistant';
import { CategoryNotFoundError } from '@usecases/category/errors';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
}

/** What a 5xx tells the client. Details go to the log, never to the body. */
const GENERIC_SERVER_MESSAGE =
  'Something went wrong on our side. Please try again.';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toHttp(exception);

    if (status >= 500) {
      this.logger.error(
        exception instanceof Error
          ? (exception.stack ?? exception.message)
          : String(exception),
        exception instanceof Error && exception.cause !== undefined
          ? `cause: ${String((exception.cause as Error)?.message ?? exception.cause)}`
          : undefined,
      );
    }

    res.status(status).json(body);
  }

  private toHttp(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const message =
        status >= 500
          ? GENERIC_SERVER_MESSAGE
          : typeof resp === 'string'
            ? resp
            : typeof resp === 'object' && resp && 'message' in resp
              ? String((resp as { message: unknown }).message)
              : exception.message;
      return httpBody(status, message);
    }

    if (exception instanceof InvalidInputError) {
      return httpBody(HttpStatus.BAD_REQUEST, exception.message);
    }

    if (
      exception instanceof TaskNotFoundError ||
      exception instanceof UserNotFoundError ||
      exception instanceof CategoryNotFoundError ||
      // Nothing to point at: the task was not made from a chat message.
      exception instanceof NoSourceMessageError
    ) {
      return httpBody(HttpStatus.NOT_FOUND, exception.message);
    }
    // The task had a source message once, but it was deleted from the chat.
    if (exception instanceof SourceMessageGoneError) {
      return httpBody(
        HttpStatus.CONFLICT,
        'The message this task came from was deleted from the chat.',
      );
    }

    // The text was read fine but holds no new task (chat, garbage, a time
    // that already passed): say so, and save nothing.
    if (exception instanceof NotATaskError) {
      return httpBody(HttpStatus.UNPROCESSABLE_ENTITY, exception.message);
    }
    if (exception instanceof InterpretationFailedError) {
      return httpBody(
        HttpStatus.BAD_GATEWAY,
        'Could not understand that reminder. Try again or rephrase it.',
      );
    }
    if (exception instanceof TranscriptionFailedError) {
      return httpBody(
        HttpStatus.BAD_GATEWAY,
        'Could not transcribe that recording. Try again in a quieter place.',
      );
    }
    if (exception instanceof NotificationFailedError) {
      return httpBody(
        HttpStatus.BAD_GATEWAY,
        'Telegram did not accept the message.',
      );
    }

    if (
      exception instanceof FailedToCreateTaskError ||
      exception instanceof FailedToUpdateTaskError ||
      exception instanceof FailedToSaveUserError
    ) {
      return httpBody(HttpStatus.INTERNAL_SERVER_ERROR, GENERIC_SERVER_MESSAGE);
    }

    return httpBody(HttpStatus.INTERNAL_SERVER_ERROR, GENERIC_SERVER_MESSAGE);
  }
}

function httpBody(
  status: number,
  message: string,
): { status: number; body: ErrorBody } {
  return {
    status,
    body: {
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
    },
  };
}
