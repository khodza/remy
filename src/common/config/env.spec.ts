import { EnvValidationError, loadEnv } from './env';

const valid = {
  TELEGRAM_BOT_TOKEN: '123:abc',
  OPENAI_API_KEY: 'sk-test',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.MONGODB_URI).toBe('mongodb://localhost:27017/remy');
    expect(env.JWT_EXPIRES_IN).toBe(900);
    expect(env.LOG_LEVEL).toBeUndefined();
    expect(env.INIT_DATA_MAX_AGE_SECONDS).toBe(86400);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.OWNER_TELEGRAM_ID).toBeUndefined();
    expect(env.DEV_ALLOW_MOCK_INITDATA).toBe(false);
    expect(env.BOT_MODE).toBe('polling');
    expect(env.WEBHOOK_URL).toBeUndefined();
  });

  it('coerces numbers, booleans and CSV lists', () => {
    const env = loadEnv({
      ...valid,
      PORT: '8080',
      INIT_DATA_MAX_AGE_SECONDS: '60',
      OWNER_TELEGRAM_ID: '42',
      DEV_ALLOW_MOCK_INITDATA: 'true',
      CORS_ORIGINS: 'https://a.example, https://b.example ,',
    });
    expect(env.PORT).toBe(8080);
    expect(env.INIT_DATA_MAX_AGE_SECONDS).toBe(60);
    expect(env.OWNER_TELEGRAM_ID).toBe(42);
    expect(env.DEV_ALLOW_MOCK_INITDATA).toBe(true);
    expect(env.CORS_ORIGINS).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('treats empty values (KEY= in .env) as unset', () => {
    const env = loadEnv({
      ...valid,
      OWNER_TELEGRAM_ID: '',
      OWNER_TIMEZONE: '',
      MINI_APP_URL: '',
      CORS_ORIGINS: '',
    });
    expect(env.OWNER_TELEGRAM_ID).toBeUndefined();
    expect(env.MINI_APP_URL).toBeUndefined();
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('lists every problem at once', () => {
    expect.assertions(3);
    try {
      loadEnv({ JWT_SECRET: 'short', INIT_DATA_MAX_AGE_SECONDS: 'abc' });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const problems = (err as EnvValidationError).problems.join('\n');
      expect(problems).toMatch(/TELEGRAM_BOT_TOKEN/);
      expect(problems).toMatch(/JWT_SECRET: JWT_SECRET must be at least 32/);
    }
  });

  it('refuses the mock-initData switch and empty CORS in production', () => {
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        DEV_ALLOW_MOCK_INITDATA: '1',
      }),
    ).toThrow(/DEV_ALLOW_MOCK_INITDATA: must be false in production/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      /CORS_ORIGINS: is required in production/,
    );
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://web.telegram.org',
      }),
    ).not.toThrow();
  });

  it('parses JWT_EXPIRES_IN into seconds and rejects other formats', () => {
    expect(loadEnv({ ...valid, JWT_EXPIRES_IN: '15m' }).JWT_EXPIRES_IN).toBe(
      900,
    );
    expect(loadEnv({ ...valid, JWT_EXPIRES_IN: '2h' }).JWT_EXPIRES_IN).toBe(
      7200,
    );
    expect(loadEnv({ ...valid, JWT_EXPIRES_IN: '7d' }).JWT_EXPIRES_IN).toBe(
      604800,
    );
    expect(loadEnv({ ...valid, JWT_EXPIRES_IN: '600' }).JWT_EXPIRES_IN).toBe(
      600,
    );
    for (const bad of ['15 minutes', 'abc', '-5m', '0', '1.5h']) {
      expect(() => loadEnv({ ...valid, JWT_EXPIRES_IN: bad })).toThrow(
        /JWT_EXPIRES_IN/,
      );
    }
  });

  describe('BOT_MODE', () => {
    const webhook = {
      ...valid,
      BOT_MODE: 'webhook',
      WEBHOOK_URL: 'https://remy.example.com/telegram/webhook',
      WEBHOOK_SECRET: 'a-Z_0-9',
    };

    it('accepts a complete webhook configuration', () => {
      const env = loadEnv(webhook);
      expect(env.BOT_MODE).toBe('webhook');
      expect(env.WEBHOOK_URL).toBe('https://remy.example.com/telegram/webhook');
      expect(env.WEBHOOK_SECRET).toBe('a-Z_0-9');
    });

    it('requires WEBHOOK_URL and WEBHOOK_SECRET in webhook mode, not in polling', () => {
      expect(() => loadEnv({ ...valid, BOT_MODE: 'webhook' })).toThrow(
        /WEBHOOK_URL: is required when BOT_MODE=webhook[\s\S]*WEBHOOK_SECRET: is required when BOT_MODE=webhook/,
      );
      expect(() => loadEnv({ ...valid, BOT_MODE: 'polling' })).not.toThrow();
      expect(() => loadEnv({ ...valid, BOT_MODE: 'push' })).toThrow(/BOT_MODE/);
    });

    it('insists on an https URL with a path and a Telegram-safe secret', () => {
      expect(() =>
        loadEnv({ ...webhook, WEBHOOK_URL: 'http://remy.example.com/hook' }),
      ).toThrow(/WEBHOOK_URL: must be an https URL/);
      expect(() =>
        loadEnv({ ...webhook, WEBHOOK_URL: 'https://remy.example.com' }),
      ).toThrow(/WEBHOOK_URL: must have a path/);
      expect(() =>
        loadEnv({ ...webhook, WEBHOOK_SECRET: 'has spaces' }),
      ).toThrow(/WEBHOOK_SECRET: must be 1-256 characters/);
      expect(() =>
        loadEnv({ ...webhook, WEBHOOK_SECRET: 'x'.repeat(257) }),
      ).toThrow(/WEBHOOK_SECRET/);
    });
  });
});
