import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { RefreshPinnedAgendaUsecase } from '@usecases/rhythm';

/**
 * After a successful write from the Mini App (anything but GET), asks for
 * the pinned "Today" message to be redrawn. Fire-and-forget: the response
 * never waits for Telegram.
 */
@Injectable()
export class PinnedAgendaInterceptor implements NestInterceptor {
  constructor(private readonly refresh: RefreshPinnedAgendaUsecase) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const userId = req.auth?.userId;
    if (req.method === 'GET' || userId === undefined) return next.handle();
    return next.handle().pipe(
      tap({
        next: () => this.refresh.refreshSoon({ userId }),
      }),
    );
  }
}
