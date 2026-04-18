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
import { TaskNotFoundError } from '@domain/task';
import { UserNotFoundError } from '@domain/user';
import {
  ParsingFailedError,
  TranscriptionFailedError,
} from '@domain/ai';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toHttp(exception);

    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json(body);
  }

  private toHttp(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const message =
        typeof resp === 'string'
          ? resp
          : typeof resp === 'object' && resp && 'message' in resp
            ? String((resp as { message: unknown }).message)
            : exception.message;
      return {
        status,
        body: {
          statusCode: status,
          error: HttpStatus[status] ?? 'Error',
          message,
        },
      };
    }

    if (exception instanceof InvalidInputError) {
      return httpBody(HttpStatus.BAD_REQUEST, exception.message);
    }

    if (
      exception instanceof TaskNotFoundError ||
      exception instanceof UserNotFoundError
    ) {
      return httpBody(HttpStatus.NOT_FOUND, exception.message);
    }

    if (
      exception instanceof ParsingFailedError ||
      exception instanceof TranscriptionFailedError
    ) {
      return httpBody(HttpStatus.BAD_GATEWAY, exception.message);
    }

    if (exception instanceof Error) {
      return httpBody(HttpStatus.INTERNAL_SERVER_ERROR, exception.message);
    }

    return httpBody(HttpStatus.INTERNAL_SERVER_ERROR, 'Unexpected error');
  }
}

function httpBody(status: number, message: string): {
  status: number;
  body: ErrorBody;
} {
  return {
    status,
    body: {
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
    },
  };
}
