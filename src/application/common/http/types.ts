export interface AuthContext {
  /** Internal user id (MongoDB ObjectId hex). */
  userId: string;
  /** Telegram user id. */
  telegramUserId: number;
  /**
   * When the session began (unix seconds): the initData exchange. Kept
   * across POST /auth/refresh so a session can't be stretched forever.
   */
  authAt?: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    initDataRaw?: string;
  }
}
