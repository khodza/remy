export type SendPendingRemindersOutput = {
  sentCount: number;
  failedCount: number;
  /** Claimed during quiet hours and put back until the window ends. */
  heldCount: number;
};
