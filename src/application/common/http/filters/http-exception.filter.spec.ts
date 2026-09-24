import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { InvalidInputError } from '@common/errors';
import {
  FailedToUpdateTaskError,
  NoSourceMessageError,
  TaskNotFoundError,
} from '@domain/task';
import {
  NotificationFailedError,
  SourceMessageGoneError,
} from '@domain/notification/errors';
import { InterpretationFailedError, NotATaskError } from '@domain/assistant';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  new HttpExceptionFilter().catch(exception, host);
  return {
    status: status.mock.calls[0]?.[0] as number,
    body: json.mock.calls[0]?.[0] as Record<string, unknown>,
  };
}

describe('HttpExceptionFilter', () => {
  it('passes 4xx HttpException messages through', () => {
    const { status, body } = run(new BadRequestException('bad id'));
    expect(status).toBe(400);
    expect(body).toEqual({
      statusCode: 400,
      error: 'BAD_REQUEST',
      message: 'bad id',
    });
  });

  it('maps domain errors', () => {
    expect(run(new InvalidInputError('nope')).status).toBe(400);
    expect(run(new TaskNotFoundError('missing')).status).toBe(404);
    expect(
      run(new InterpretationFailedError('x', new Error('openai down'))).status,
    ).toBe(502);
    expect(run(new NotATaskError('That time has already passed.'))).toEqual({
      status: 422,
      body: {
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        message: 'That time has already passed.',
      },
    });
  });

  it('show-source: no source message is 404, a deleted one 409, a refused reply 502', () => {
    expect(run(new NoSourceMessageError('not from a chat message'))).toEqual({
      status: 404,
      body: {
        statusCode: 404,
        error: 'NOT_FOUND',
        message: 'not from a chat message',
      },
    });
    const gone = run(new SourceMessageGoneError('gone', new Error('400')));
    expect(gone.status).toBe(409);
    expect(gone.body['error']).toBe('CONFLICT');
    expect(String(gone.body['message'])).toMatch(/deleted/);
    expect(
      run(
        new NotificationFailedError('x', new Error('403'), { permanent: true }),
      ).status,
    ).toBe(502);
  });

  it('never leaks internal messages on 5xx', () => {
    const wrapped = run(
      new FailedToUpdateTaskError(
        'Failed',
        new Error('MongoServerError: E11000'),
      ),
    );
    expect(wrapped.status).toBe(500);
    expect(String(wrapped.body['message'])).not.toMatch(/Mongo|E11000|Failed/);

    const plain = run(new Error('Cast to ObjectId failed for value "abc"'));
    expect(plain.status).toBe(500);
    expect(String(plain.body['message'])).not.toMatch(/ObjectId/);

    const nest = run(new InternalServerErrorException('stack details'));
    expect(String(nest.body['message'])).not.toMatch(/stack details/);
  });
});
