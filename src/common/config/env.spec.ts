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
    expect(env.INIT_DATA_MAX_AGE_SECONDS).toBe(86400);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.OWNER_TELEGRAM_ID).toBeUndefined();
    expect(env.DEV_ALLOW_MOCK_INITDATA).toBe(false);
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
});
