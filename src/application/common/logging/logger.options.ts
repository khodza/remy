import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '@common/config';

/**
 * Structured logging (pino via nestjs-pino). Every HTTP request gets a
 * request id (an incoming `x-request-id` is kept, otherwise a UUID), echoed
 * back in the response header and attached to every log line written while
 * the request is handled. JSON in production, pretty in development, silent
 * in tests unless LOG_LEVEL says otherwise.
 */

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accept a caller's id only if it is short and harmless to echo back. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Credentials that must never reach a log line. */
export const REDACT_PATHS = [
  'req.headers.authorization', // Bearer JWT, or `tma <initData>`
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'req.query.initData',
  'req.body.initData',
  'res.headers["set-cookie"]',
  'initData',
  '*.initData',
];

export function resolveRequestId(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id =
    candidate !== undefined && SAFE_REQUEST_ID.test(candidate)
      ? candidate
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/** The calendar feed URL carries its secret in the path. */
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(/\/calendar\/[^/?#]+\.ics/, '/calendar/[Redacted].ics');
}

export function defaultLogLevel(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>) {
  if (env.LOG_LEVEL !== undefined) return env.LOG_LEVEL;
  if (env.NODE_ENV === 'production') return 'info';
  if (env.NODE_ENV === 'test') return 'silent';
  return 'debug';
}

function prettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    // Production images prune dev dependencies; fall back to JSON.
    return false;
  }
}

export function loggerParams(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Params {
  const pretty = env.NODE_ENV === 'development' && prettyAvailable();
  return {
    pinoHttp: {
      level: defaultLogLevel(env),
      genReqId: resolveRequestId,
      // Log lines inside a request carry only `reqId`, not the whole req.
      quietReqLogger: true,
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
      serializers: {
        // `params` is the logger middleware's own wildcard match (it would
        // repeat the calendar token); the URL is enough.
        req: (req: { url?: string; params?: unknown }) => {
          delete req.params;
          req.url = redactUrl(req.url);
          return req;
        },
      },
      customLogLevel: (_req, res, error) => {
        if (error !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        // Docker/uptime probes hit /health every few seconds. A failing
        // check is logged by the health controller itself.
        ignore: (req) => fullUrl(req)?.startsWith('/api/v1/health') ?? false,
      },
      customSuccessMessage: (req, res, responseTime) =>
        `${req.method} ${redactUrl(fullUrl(req))} ${res.statusCode} ${Math.round(responseTime)}ms`,
      customErrorMessage: (req, res, error) =>
        `${req.method} ${redactUrl(fullUrl(req))} ${res.statusCode} ${error.message}`,
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname,context,req,res,responseTime',
                messageFormat: '{if context}[{context}] {end}{msg}',
              },
            },
          }
        : {}),
    },
  };
}

/** Express sets originalUrl; a mounted middleware may see a shortened url. */
function fullUrl(req: IncomingMessage): string | undefined {
  return (
    (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url
  );
}
