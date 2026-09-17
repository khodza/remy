// Baseline environment for unit tests. Individual specs may override values
// in beforeEach; getEnv() re-reads process.env on every call when NODE_ENV
// is "test", so overrides take effect immediately.
process.env['NODE_ENV'] = 'test';
process.env['TELEGRAM_BOT_TOKEN'] ??= 'test-bot-token:AAHtest';
process.env['OPENAI_API_KEY'] ??= 'sk-test';
process.env['JWT_SECRET'] ??= 'test-jwt-secret-that-is-at-least-32-chars-long';
