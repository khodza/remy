import { Injectable, Inject } from '@nestjs/common';
import type {
  UserRepository,
  UserSettings,
  UserSettingsPatch,
} from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { Domain } from '@common/tokens';
import { InvalidInputError } from '@common/errors';

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Applies a one-level-deep partial onto the stored settings. */
export function mergeSettingsPatch(
  current: UserSettings,
  patch: UserSettingsPatch,
): UserSettings {
  return {
    hour12: patch.hour12 ?? current.hour12,
    weekStartsOn: patch.weekStartsOn ?? current.weekStartsOn,
    defaultView: patch.defaultView ?? current.defaultView,
    morningBrief: { ...current.morningBrief, ...patch.morningBrief },
    eveningReview: { ...current.eveningReview, ...patch.eveningReview },
    quietHours: { ...current.quietHours, ...patch.quietHours },
    escalation: {
      enabled: patch.escalation?.enabled ?? current.escalation.enabled,
      stepsMinutes: [
        ...(patch.escalation?.stepsMinutes ?? current.escalation.stepsMinutes),
      ],
    },
  };
}

@Injectable()
export class UpdateSettingsUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  public async execute(input: {
    userId: string;
    patch: UserSettingsPatch;
  }): Promise<UserSettings> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) throw new UserNotFoundError(`User ${input.userId} not found`);

    const next = mergeSettingsPatch(user.settings, input.patch);

    for (const time of [
      next.morningBrief.time,
      next.eveningReview.time,
      next.quietHours.from,
      next.quietHours.to,
    ]) {
      if (!TIME_OF_DAY.test(time)) {
        throw new InvalidInputError(`Invalid time of day: ${time}`);
      }
    }
    const steps = next.escalation.stepsMinutes;
    if (
      steps.some(
        (m, i) =>
          !Number.isInteger(m) || m < 1 || (i > 0 && m <= steps[i - 1]!),
      )
    ) {
      throw new InvalidInputError(
        'Escalation steps must be increasing positive minutes',
      );
    }

    const updated = await this.userRepository.update({
      id: input.userId,
      settings: next,
    });
    return updated.settings;
  }
}
