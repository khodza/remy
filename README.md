# Remy

AI reminder assistant for Telegram. Send the bot a message or a voice note
("call mom tomorrow at 5", "take vitamins every day at 9") and it reminds you at
the right time with Done / Delay buttons. A Telegram Mini App
([`../remy-webapp`](../remy-webapp)) shows your day and lets you edit tasks.

This repo is the backend: NestJS + grammY (bot) + MongoDB + OpenAI, exposing an
HTTP API under `/api/v1` for the Mini App.

## Quick start

```bash
nvm use                      # Node 22 (see .nvmrc)
npm install                  # also installs the git pre-commit hook (husky)
cp .env.example .env         # fill TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, JWT_SECRET, OWNER_TELEGRAM_ID
npm run dev                  # starts Mongo (docker compose) + API in watch mode on :3000
```

Without Docker: run your own MongoDB and use `npm run dev:api`.

The process refuses to start if a required variable is missing or malformed and
prints the full list of problems (`src/common/config/env.ts` is the schema).

## Everyday commands

| Command | What |
|---|---|
| `npm run dev` | Mongo via docker compose, then the API in watch mode |
| `npm run dev:api` | API in watch mode only |
| `npm run check` | typecheck + lint + unit tests (what CI should run) |
| `npm test` / `npm run test:watch` | unit tests (jest, ts-jest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint with autofix |
| `npm run build` | compile to `build/` (SWC) |
| `npm run start:prod:api` | run the compiled build |

A pre-commit hook runs eslint + prettier on staged `.ts` files.

## How it works

1. **Capture.** `message:text` / `message:voice` → `MessageHandler` →
   `ProcessTextMessageUsecase` (voice is transcribed with Whisper first) →
   `TaskParserGateway` (gpt-4o-mini, JSON output, the prompt receives the
   current time in the user's timezone) → task saved in Mongo, including an
   optional recurrence.
2. **Remind.** A cron runs every minute (`ReminderScheduler` →
   `SendPendingRemindersUsecase`): roll ignored recurring tasks onto their
   latest occurrence, then atomically claim and send every pending task whose
   `nextFireAt` has come (a crash between claim and send can never duplicate
   a reminder; transient Telegram errors are retried after 2 minutes).
   Buttons: ✅ Done, +15 min, +1 hour. Times are shown in the task's timezone.
3. **Act.** Callback queries (`CallbackHandler`) complete, delay or delete a
   task, always checking the task belongs to the tapping user. Done on a
   recurring task moves it to the next occurrence.
4. **Mini App API.** `POST /auth/telegram` exchanges Telegram initData
   (`Authorization: tma <raw>`) for a 15-minute JWT; everything else uses
   `Authorization: Bearer <jwt>`. See the frontend's
   `src/shared/api/CLAUDE.md` for the contract.

## Layout (Clean Architecture)

```
src/
├── domain/          types, repository + gateway interfaces, errors (no framework code)
├── usecases/        one folder per use case: task/*, user/*
├── infrastructure/  mongodb/, openai/, bot/ (grammY handlers), scheduler/
├── application/     Nest modules and the HTTP layer (controllers, DTOs, guards, filter)
└── common/          config (env schema), tokens (DI symbols), validation, recurrence math
```

Path aliases: `@domain/*`, `@usecases/*`, `@infra/*`, `@application/*`,
`@common/*`.

## Timezones

Every task stores the IANA zone it was created in. New users get
`OWNER_TIMEZONE`; the Mini App replaces it with the phone's zone on first
open; `/settings` offers a short list. Snoozing a repeating task moves only
that occurrence (`snoozedUntil`), never the series.

## Single-owner mode

Set `OWNER_TELEGRAM_ID` to your Telegram user id. The bot then answers only you
("🔒 This is a private bot." to anyone else, with no DB or OpenAI work), and
the HTTP guards reject other users' initData and tokens.

## Developing the Mini App against this backend from a plain browser

The frontend's `pnpm dev` fakes the Telegram environment with
`hash=dev-mock-hash` initData. To let this backend accept it:

```
DEV_ALLOW_MOCK_INITDATA=true
OWNER_TELEGRAM_ID=123456789   # the frontend's VITE_MOCK_TG_USER_ID, or unset
```

Only honoured when `NODE_ENV` is not `production`; the boot log warns while it
is on.

## Environment variables

See [`.env.example`](.env.example); every variable is documented there.

## Tests

Unit tests live next to the code (`*.spec.ts`) and use mocks only; there is no
database or network in the suite. `test/setup-env.ts` provides a baseline
environment. `npm run test:e2e` is wired (`test/jest-e2e.json`) but there are
no e2e specs yet.

## Roadmap

The full plan (bugs, features, phases) lives in `../remy-plan/`.
