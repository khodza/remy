import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';

export type ManageCalendarFeedInput = {
  userId: string;
  /** enable also replaces an existing link (the old one stops working). */
  action: 'get' | 'enable' | 'disable';
};
export type CalendarFeedState = { enabled: boolean; token: string | null };

/** 32 random bytes: the only thing between the feed and the internet. */
export const CALENDAR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class ManageCalendarFeedUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
  ) {}

  public async execute(
    input: ManageCalendarFeedInput,
  ): Promise<CalendarFeedState> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);

    if (input.action === 'get') {
      return {
        enabled: user.calendarToken !== null,
        token: user.calendarToken,
      };
    }
    const token =
      input.action === 'enable' ? randomBytes(32).toString('base64url') : null;
    await this.users.update({ id: user.id, calendarToken: token });
    return { enabled: token !== null, token };
  }
}
