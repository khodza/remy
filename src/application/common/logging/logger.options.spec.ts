import { Writable } from 'node:stream';
import express from 'express';
import { pinoHttp, type Options } from 'pino-http';
import request from 'supertest';
import {
  defaultLogLevel,
  loggerParams,
  redactUrl,
  REQUEST_ID_HEADER,
} from './logger.options';

/** An express app logging through our pino-http options into memory. */
function appWithLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const params = loggerParams({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
  const app = express();
  // Mounted the way Nest mounts middleware (a wildcard route), which puts
  // the whole path into req.params.
  app.all('/{*splat}', pinoHttp(params.pinoHttp as Options, stream));
  app.get('/api/v1/tasks', (req, res) => {
    req.log.info({ initData: 'user=...&hash=abc' }, 'inside the request');
    res.json({ ok: true });
  });
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/calendar/{*splat}', (_req, res) => res.send('BEGIN'));
  return { app, lines };
}

describe('logger options', () => {
  it('picks a level per environment unless LOG_LEVEL is set', () => {
    expect(
      defaultLogLevel({ NODE_ENV: 'production', LOG_LEVEL: undefined }),
    ).toBe('info');
    expect(
      defaultLogLevel({ NODE_ENV: 'development', LOG_LEVEL: undefined }),
    ).toBe('debug');
    expect(defaultLogLevel({ NODE_ENV: 'test', LOG_LEVEL: undefined })).toBe(
      'silent',
    );
    expect(defaultLogLevel({ NODE_ENV: 'production', LOG_LEVEL: 'warn' })).toBe(
      'warn',
    );
  });

  it('is JSON (no pretty transport) outside development', () => {
    const params = loggerParams({
      NODE_ENV: 'production',
      LOG_LEVEL: undefined,
    });
    expect((params.pinoHttp as Options).transport).toBeUndefined();
    const dev = loggerParams({ NODE_ENV: 'development', LOG_LEVEL: undefined });
    expect((dev.pinoHttp as Options).transport).toMatchObject({
      target: 'pino-pretty',
    });
  });

  it('masks the calendar feed token in URLs', () => {
    expect(redactUrl(`/api/v1/calendar/${'a'.repeat(43)}.ics`)).toBe(
      '/api/v1/calendar/[Redacted].ics',
    );
    expect(redactUrl('/api/v1/tasks?view=today')).toBe(
      '/api/v1/tasks?view=today',
    );
  });

  it('keeps an incoming x-request-id, echoes it and tags every line with it', async () => {
    const { app, lines } = appWithLogs();
    const res = await request(app)
      .get('/api/v1/tasks')
      .set(REQUEST_ID_HEADER, 'trace-123')
      .expect(200);
    expect(res.headers[REQUEST_ID_HEADER]).toBe('trace-123');
    const inside = lines.find((l) => l['msg'] === 'inside the request');
    expect(inside?.['reqId']).toBe('trace-123');
    const done = lines.find((l) =>
      String(l['msg']).startsWith('GET /api/v1/tasks 200'),
    );
    expect(done?.['req']).toMatchObject({ id: 'trace-123' });
  });

  it('makes up a request id when the incoming one is missing or unsafe', async () => {
    const { app } = appWithLogs();
    const a = await request(app).get('/api/v1/tasks').expect(200);
    expect(a.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app)
      .get('/api/v1/tasks')
      .set(REQUEST_ID_HEADER, 'x'.repeat(500))
      .expect(200);
    expect(b.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never logs the Authorization header, initData or the feed token', async () => {
    const { app, lines } = appWithLogs();
    const token = 'b'.repeat(43);
    await request(app)
      .get('/api/v1/tasks')
      .set('Authorization', 'tma user=%7B%22id%22%3A1%7D&hash=deadbeef')
      .expect(200);
    await request(app).get(`/api/v1/calendar/${token}.ics`).expect(200);

    const all = JSON.stringify(lines);
    expect(all).not.toContain('deadbeef');
    expect(all).not.toContain('hash=abc');
    expect(all).not.toContain(token);
    expect(all).toContain('[Redacted]');
  });

  it('does not log successful health probes', async () => {
    const { app, lines } = appWithLogs();
    await request(app).get('/api/v1/health').expect(200);
    expect(lines).toHaveLength(0);
  });
});
