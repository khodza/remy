import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { parse, validate } from '@tma.js/init-data-node';
import type { Request } from 'express';
import { getEnv } from '@common/config';

/** Hash the frontend's mockTelegramEnv puts into its fake initData. */
export const DEV_MOCK_HASH = 'dev-mock-hash';

@Injectable()
export class InitDataGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const match = /^tma\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      throw new UnauthorizedException('Missing tma initData authorization');
    }
    let initDataRaw = match[1].trim();
    const env = getEnv();

    if (isDevMockInitData(initDataRaw)) {
      if (!(env.DEV_ALLOW_MOCK_INITDATA && env.NODE_ENV !== 'production')) {
        throw new UnauthorizedException('Mock initData is not accepted');
      }
      assertMockInitDataShape(initDataRaw);
      initDataRaw = withSignatureField(initDataRaw);
    } else {
      try {
        validate(initDataRaw, env.TELEGRAM_BOT_TOKEN, {
          expiresIn: env.INIT_DATA_MAX_AGE_SECONDS,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Invalid Telegram initData';
        throw new UnauthorizedException(message);
      }
    }

    if (env.OWNER_TELEGRAM_ID !== undefined) {
      const userId = parse(initDataRaw).user?.id;
      if (userId !== env.OWNER_TELEGRAM_ID) {
        throw new ForbiddenException('This is a private bot');
      }
    }

    req.initDataRaw = initDataRaw;
    return true;
  }
}

/**
 * `parse()` from init-data-node requires a `signature` field (Bot API 8+
 * initData always has one, possibly empty). Mock data may omit it.
 */
function withSignatureField(initDataRaw: string): string {
  const params = new URLSearchParams(initDataRaw);
  if (params.has('signature')) return initDataRaw;
  params.set('signature', '');
  return params.toString();
}

function isDevMockInitData(initDataRaw: string): boolean {
  return new URLSearchParams(initDataRaw).get('hash') === DEV_MOCK_HASH;
}

/**
 * The mock skips HMAC, but it must still look like real initData so the
 * rest of the pipeline (parse → user) behaves identically.
 */
function assertMockInitDataShape(initDataRaw: string): void {
  const params = new URLSearchParams(initDataRaw);
  if (!params.get('auth_date')) {
    throw new UnauthorizedException('Mock initData is missing auth_date');
  }
  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    throw new UnauthorizedException('Mock initData has no valid user');
  }
  if (
    typeof user !== 'object' ||
    user === null ||
    typeof (user as { id?: unknown }).id !== 'number'
  ) {
    throw new UnauthorizedException(
      'Mock initData user must have a numeric id',
    );
  }
}
