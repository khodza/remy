import { GrammyError } from 'grammy';

/**
 * Telegram rejects edits that don't change anything (a second tap on Done)
 * with 400 "message is not modified". That is not a failure for us.
 */
export function isNotModifiedError(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /message is not modified/i.test(error.description)
  );
}

export async function ignoreNotModified(
  promise: Promise<unknown>,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isNotModifiedError(error)) throw error;
  }
}
