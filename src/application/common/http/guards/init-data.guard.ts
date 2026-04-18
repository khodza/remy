import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { validate } from '@tma.js/init-data-node';
import type { Request } from 'express';

const DEFAULT_EXPIRES_IN_SECONDS = 86400; // 24h

@Injectable()
export class InitDataGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const match = /^tma\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      throw new UnauthorizedException('Missing tma initData authorization');
    }
    const initDataRaw = match[1].trim();

    const token = process.env['TELEGRAM_BOT_TOKEN'];
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const expiresIn = parseInt(
      process.env['INIT_DATA_MAX_AGE_SECONDS'] ?? String(DEFAULT_EXPIRES_IN_SECONDS),
      10,
    );

    try {
      validate(initDataRaw, token, { expiresIn });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Invalid Telegram initData';
      throw new UnauthorizedException(message);
    }

    req.initDataRaw = initDataRaw;
    return true;
  }
}
