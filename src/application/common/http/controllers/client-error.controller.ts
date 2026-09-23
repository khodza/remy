import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  HttpCode,
  Injectable,
  Logger,
  PayloadTooLargeException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClientErrorReport } from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import type { AuthContext } from '../types';

/** Bigger reports are refused (413) before they are validated or logged. */
export const CLIENT_ERROR_MAX_BYTES = 16 * 1024;

/** Guards run before pipes, so the size check comes before validation. */
@Injectable()
export class ClientErrorSizeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (Number(req.headers['content-length'] ?? 0) > CLIENT_ERROR_MAX_BYTES) {
      throw new PayloadTooLargeException('Error report too large');
    }
    return true;
  }
}

/**
 * The Mini App's window.onerror / error boundary reports land in the
 * server log, so a crash on the owner's phone is visible without a
 * debugger. One JSON line per report (no log injection through newlines).
 */
@Controller('client-errors')
@UseGuards(JwtAuthGuard, ClientErrorSizeGuard)
export class ClientErrorController {
  private readonly logger = new Logger('ClientError');

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  report(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(ClientErrorReport)) dto: ClientErrorReport,
  ): void {
    this.logger.warn(JSON.stringify({ userId: auth.userId, ...dto }));
  }
}
