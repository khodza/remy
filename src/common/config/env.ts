import { z } from 'zod';

/**
 * Single source of truth for environment configuration. Parsed once at boot
 * (via ConfigModule's `validate`) so a missing or malformed variable fails
 * fast with a readable list instead of surfacing as a runtime error later.
 */

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const boolish = z.preprocess((value) => {
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}, z.boolean());

const csv = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
    MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/remy'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().min(1).default('15m'),
    INIT_DATA_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(86400),
    /** Comma-separated allowlist. Empty = reflect any origin (dev only). */
    CORS_ORIGINS: csv,

    /**
     * Remy is a single-owner bot. When set, the bot ignores every other
     * Telegram user and the HTTP API rejects their initData / tokens.
     */
    OWNER_TELEGRAM_ID: z.coerce.number().int().positive().optional(),
    /**
     * IANA timezone applied to new users and to legacy tasks without one.
     * The Mini App overrides it with the detected zone on first open.
     */
    OWNER_TIMEZONE: z
      .string()
      .min(1)
      .optional()
      .refine((tz) => tz === undefined || isValidTimeZone(tz), {
        message: 'must be a valid IANA timezone such as Asia/Tashkent',
      }),

    /**
     * Development only: accept the Mini App's mocked initData
     * (`hash=dev-mock-hash`) without HMAC verification so the frontend can be
     * used from a plain browser. Refused in production.
     */
    DEV_ALLOW_MOCK_INITDATA: boolish.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.DEV_ALLOW_MOCK_INITDATA) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_ALLOW_MOCK_INITDATA'],
        message: 'must be false in production',
      });
    }
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'is required in production (comma-separated origins)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems
        .map((p) => `  - ${p}`)
        .join('\n')}\nSee .env.example for the expected variables.`,
    );
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `${key}: ${issue.message}`;
  });
  throw new EnvValidationError(problems);
}

let cached: Env | undefined;

/**
 * Cached accessor for code that runs after boot. In tests the cache is
 * bypassed so each spec can set up its own process.env.
 */
export function getEnv(): Env {
  if (process.env['NODE_ENV'] === 'test') return loadEnv();
  cached ??= loadEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
