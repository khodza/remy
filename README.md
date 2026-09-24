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
| `npm run assistant:try -- "buy milk, call mom at 5"` | run phrases through the real intent router (OpenAI) and print what Remy would do; no DB, no Telegram |
| `npm run seed` | insert a realistic sample day for the owner (`-- --reset`, `-- --dry-run`) |
| `npm run contract:sync` / `contract:check` | regenerate / verify the frontend's copy of the HTTP contract |
| `npm run start:prod:api` | run the compiled build |

A pre-commit hook runs eslint + prettier on staged `.ts` files.

## How it works

1. **Understand.** Every chat message (typed, voice after Whisper, or a
   tapped answer) goes to `HandleMessageUsecase`. The `InterpreterGateway`
   (OpenAI structured outputs, strict JSON schema) classifies it as one of
   `create` (several tasks at once, todos without a date, "remind me before",
   rich repeats), `query`, `complete`, `reschedule`, `delete`, `edit`, `chat`
   or `unclear` (Remy asks one question with tappable answers). The model
   sees the user's open tasks as a numbered list and answers with numbers, so
   "the dentist" or a reply to a message resolves to real task ids.
   `interpretAssistantOutput` then guards the result: durations are added by
   the server, first occurrences are aligned, past times and ungrounded
   targets become questions instead of actions. A forwarded message is kept
   and Remy asks "when?". Every change records an Undo (10 minutes).
   The Mini App's `/ai/parse`, `POST /tasks` and `POST /tasks/voice` read
   text with the same interpreter (`ParseTaskUsecase`); text that holds no
   new task is a 422, never an invented task.
2. **Remind.** A cron runs every minute (`ReminderScheduler` →
   `SendPendingRemindersUsecase`): roll ignored recurring tasks onto their
   latest occurrence, then atomically claim and send every pending task whose
   `nextFireAt` has come (a crash between claim and send can never duplicate
   a reminder; transient Telegram errors are retried after 2 minutes).
   Buttons: ✅ Done, +15m → HH:mm, +1h → HH:mm, Tonight, Tomorrow. Times are
   shown in the task's timezone. A "remind me before" heads-up fires first;
   an ignored reminder is nudged again at each escalation step (30 min and
   2 h by default, never for low priority); during quiet hours pings are held
   until the window ends (high priority can ring through).
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

## Daily rhythm

The same minute cron also sends, per user and once per local day (claimed
atomically, with a 3-hour catch-up window after downtime):

- **Morning brief** (default 08:00): today's reminders, overdue ones, the
  Inbox; numbered so a reply like "done with 2" works; a button moves every
  overdue task to today, keeping its time of day. `/today` shows it on demand.
- **Evening review** (default 21:00): what is still open, each with one-tap
  Done / Tomorrow 09:00 / No date (Skip for repeating tasks); the message
  redraws itself row by row.
- **Weekly wrap** on the last day of the week: things done, streak, what is
  still overdue, what keeps getting snoozed, next week's load.

All times and switches live in the user's settings (`GET/PATCH /settings`,
Mini App → Settings → Daily rhythm).

## Google Calendar (optional)

Remy can read the owner's Google Calendar (read-only) and list the day's
events in the morning brief and `/today` in a short "📅 Calendar" block
(all-day events first, cancelled and declined ones skipped, shown in the
profile zone). Nothing is written to Google; tasks still reach calendars
through the `.ics` feed.

**Google Cloud, once (about five minutes):**

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project (or pick one) → **APIs & Services → Library** → enable the
   **Google Calendar API**.
2. **APIs & Services → OAuth consent screen**: External, app name "Remy",
   your e-mail as support and developer contact. Under **Audience** keep
   the app in **Testing** and add your own Google account as a test user
   (a single-owner bot never needs verification). Scopes are requested at
   runtime: `calendar.readonly` and `userinfo.email` only.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**. Add exactly one authorised redirect URI: the
   API's public callback, `https://<your host>/api/v1/integrations/google/callback`
   (must match `GOOGLE_REDIRECT_URL` byte for byte).
4. Put the client id and secret in `.env`:

   ```
   GOOGLE_CLIENT_ID=….apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   GOOGLE_REDIRECT_URL=https://<your host>/api/v1/integrations/google/callback
   GOOGLE_TOKEN_KEY=<any 32+ random characters, optional>
   ```

Then send `/connect` to the bot: it answers with a "Connect Google Calendar"
button (the link is signed for you and valid for 10 minutes), Google asks for
consent, the callback stores the tokens and the bot confirms in the chat.
`/connect` again shows the account and which calendars feed the brief;
`/connect off` disconnects (the grant is revoked at Google and the tokens are
deleted). A refresh token in Testing mode expires after 7 days of no use;
`/connect` again fixes that.

For the Mini App: `GET /integrations/google/status`, `POST …/connect`
(returns the consent URL, to open in the system browser), `PATCH
/integrations/google { calendarIds }` picks calendars (empty = primary),
`DELETE /integrations/google` disconnects. Tokens are stored AES-256-GCM
encrypted with a key derived from `GOOGLE_TOKEN_KEY` (or `JWT_SECRET`); the
Google client is a small `fetch` wrapper (15 s timeout, one retry), and a
Google outage only drops the Calendar block, never the brief.

## API contract

Every request and response shape lives in one zod file,
[`src/contract/remy-contract.ts`](src/contract/remy-contract.ts): tasks (with
notes, priority, category, source, todos without a time), views
(`GET /tasks?view=today|upcoming|inbox|done`), structured create, reopen,
absolute snooze, settings and categories. The backend validates with it and
the frontend parses with a generated copy, so drift is a failing check rather
than a runtime surprise.

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

Three layers, all offline:

| Command | What it proves |
|---|---|
| `npm test` | Unit tests next to the code (`*.spec.ts`), mocks only, ~5 s. Part of `npm run check`. |
| `npm run test:int` | `TaskRepositoryImpl` against a real in-memory MongoDB: the atomic reminder claim (incl. 8 concurrent claimers), snooze re-arming, retry hold, view filters, legacy backfill. |
| `npm run test:e2e` | The real `AppModule` over HTTP (supertest) against in-memory MongoDB with only Telegram stubbed: mock login + owner lock, settings, categories, structured create, views, patch/snooze/delay/complete/reopen/delete. Every response is parsed with the contract. `google-calendar.e2e-spec.ts` runs the OAuth connect flow and the brief's Calendar block against the real Google client with a fake `fetch`. |

The first `test:int` / `test:e2e` run downloads a MongoDB binary
(mongodb-memory-server). `test/setup-env.ts` provides the baseline
environment; `test/factories.ts` has `makeTask`, `makeUser` and in-memory
repository mocks.

## Roadmap

The full plan (bugs, features, phases) lives in `../remy-plan/`.
