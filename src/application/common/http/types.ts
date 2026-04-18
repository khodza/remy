export interface AuthContext {
  /** Internal user id (MongoDB ObjectId hex). */
  userId: string;
  /** Telegram user id. */
  telegramUserId: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    initDataRaw?: string;
  }
}
