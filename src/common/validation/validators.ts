import { InvalidInputError } from '@common/errors';

/**
 * Validates that text is non-empty and within character limits
 */
export function validateText(text: string, maxLength = 4000): void {
  if (!text || text.trim().length === 0) {
    throw new InvalidInputError('Text cannot be empty');
  }

  if (text.length > maxLength) {
    throw new InvalidInputError(
      `Text too long (max ${maxLength} characters, got ${text.length})`,
    );
  }
}

/**
 * Validates delay minutes is positive and within reasonable limits
 */
export function validateDelayMinutes(delayMinutes: number): void {
  if (typeof delayMinutes !== 'number' || isNaN(delayMinutes)) {
    throw new InvalidInputError('Delay must be a valid number');
  }

  if (delayMinutes <= 0) {
    throw new InvalidInputError('Delay must be greater than 0 minutes');
  }

  const ONE_WEEK_MINUTES = 10080; // 7 days * 24 hours * 60 minutes
  if (delayMinutes > ONE_WEEK_MINUTES) {
    throw new InvalidInputError(
      `Delay too long (max 1 week / ${ONE_WEEK_MINUTES} minutes, got ${delayMinutes})`,
    );
  }
}

/**
 * Validates timezone is a valid IANA timezone string.
 * Delegates to Intl (the same engine date-fns-tz uses) instead of a name
 * pattern: real zone names vary too much ("America/New_York",
 * "America/Argentina/Buenos_Aires", "Etc/GMT+5") for a regex to cover.
 */
export function validateTimezone(timezone: string): void {
  if (!timezone || timezone.trim().length === 0) {
    throw new InvalidInputError('Timezone cannot be empty');
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (error) {
    throw new InvalidInputError(
      `Invalid timezone: "${timezone}". Expected IANA timezone like "America/New_York" or "UTC"`,
      error,
    );
  }
}

/**
 * Validates that a date is valid and optionally in the future
 */
export function validateScheduledAt(
  scheduledAt: Date,
  requireFuture = false,
): void {
  if (!(scheduledAt instanceof Date) || isNaN(scheduledAt.getTime())) {
    throw new InvalidInputError('Scheduled time must be a valid date');
  }

  if (requireFuture && scheduledAt <= new Date()) {
    throw new InvalidInputError('Scheduled time must be in the future');
  }
}
