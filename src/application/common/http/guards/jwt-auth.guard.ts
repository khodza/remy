import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getEnv } from '@common/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthContext } from '../types';

interface JwtPayload {
  sub: string;
  tgId: number;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const match = /^bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(match[1].trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid token';
      throw new UnauthorizedException(message);
    }

    const owner = getEnv().OWNER_TELEGRAM_ID;
    if (owner !== undefined && payload.tgId !== owner) {
      throw new ForbiddenException('This is a private bot');
    }

    const auth: AuthContext = {
      userId: payload.sub,
      telegramUserId: payload.tgId,
    };
    req.auth = auth;
    return true;
  }
}
