# Remy architecture

How the backend is put together, what it stores, how it talks to the Mini
App and how it runs. Read this once at the start of a session; the rules for
changing things are in [`CLAUDE.md`](../CLAUDE.md).

## The pieces

| Repo | What | Talks to |
|---|---|---|
| `remy` (this one) | One Node process: the Telegram bot (grammY), the HTTP API for the Mini App (NestJS, `/api/v1`), a cron that sends reminders and digests, MongoDB via mongoose, OpenAI for understanding text and voice. | Telegram Bot API, OpenAI, MongoDB |
| `../remy-webapp` | The Telegram Mini App (React). A separate git repo. | This API over HTTP, nothing else |
| `../remy-plan` | Roadmap, bug list, design (`PLAN.md`, `remy.html`). | — |

Remy is single-owner: `OWNER_TELEGRAM_ID` gates the bot middleware and both
HTTP guards. There is no multi-tenant story and none is planned.

## Layers (Clean Architecture)

```
src/
├── domain/          types, repository + gateway interfaces, domain errors
├── usecases/        one folder per use case (usecase.ts, types.ts, usecase.spec.ts)
├── infrastructure/  mongodb/ (schemas, repositories), openai/ (interpreter, parser,
│                    transcription), bot/ (grammY service, handlers, presenters),
│                    scheduler/ (cron)
├── application/     Nest modules; application/common/http/ = controllers, zod
│                    validation, mappers, guards, exception filter; logging/
├── contract/        remy-contract.ts: every HTTP request/response shape (zod)
└── common/          config (env schema), tokens (DI symbols), recurrence and
                     fire-time math, date formatting, iCal, export
```

The dependency rule: `domain` imports nothing from the other layers; use
cases depend on domain interfaces only (injected through `Symbol.for`
tokens in `common/tokens`); infrastructure implements those interfaces;
application wires them into Nest modules. grammY and mongoose types never
reach `domain` or `usecases`, and `domain` never imports the contract (the
HTTP layer maps between them). `common/config/env.ts` is the only place
that reads `process.env`.

## Flows

### A chat message

```
Telegram update
  → TelegramBotService (owner lock, routing)
  → MessageHandler (text / voice / forward)          infrastructure/bot/handlers
  → AssistantResponder
  → HandleMessageUsecase                             usecases/assistant/handle-message
      ├─ InterpreterGateway (OpenAI structured output, strict JSON schema)
      │    prompt: infrastructure/openai/assistant/prompt.ts
      │    schema: infrastructure/openai/assistant/schema.ts
      │    guards: infrastructure/openai/assistant/interpret-output.ts  ← all trust decisions
      ├─ task use cases (create / complete / reschedule / delete / edit / query)
      └─ conversation memory: undo record (before acting), pending question,
         pending forward, last touched tasks, bot-message → task links
  → presentAssistantResult (every Telegram string, HTML parse mode)
```

The model sees the user's open tasks as a numbered list and answers with
numbers, so "the dentist" or a reply to an earlier bot message resolves to
real task ids. The model never does clock arithmetic: durations are added
server-side, past times and ungrounded targets become questions. A
clarifying question keeps the whole exchange (`originalText` +
`answered[]`) and is replayed to the model as chat turns. Voice goes
through `TranscribeAudioUsecase` (Whisper) first and then the same path.

### A Mini App request

```
Mini App → POST /api/v1/auth/telegram (Authorization: tma <initData>)
             InitDataGuard verifies the HMAC (or the dev mock) and the owner
             → short-lived JWT
        → every other route with Authorization: Bearer <jwt>
             JwtAuthGuard → controller → ZodValidationPipe(contract schema)
             → use case → http/mappers → wire.* shape from the contract
```

Global: a throttler (120 requests / minute), `HttpExceptionFilter` (domain
errors → 4xx, generic 5xx bodies), a request id on every request
(`x-request-id`, kept from the caller when safe). The natural-language
create from the app (`POST /ai/parse`, `POST /tasks`) still uses the
simpler `TaskParserGateway`; structured saves go to `POST /tasks/structured`.

Unauthenticated routes: `GET /health` (MongoDB ping + cached Telegram
`getMe`, 503 when either is down) and `GET /calendar/<token>.ics`, where the
32-byte token is the credential.

### Every minute (the scheduler)

`ReminderScheduler` (`@Cron` every minute, `waitForCompletion`, awaited on
shutdown) runs two independent steps:

1. `SendPendingRemindersUsecase`: roll ignored recurring tasks onto their
   latest occurrence, then **claim first, send second**:
   `claimDueReminder` is an atomic `findOneAndUpdate` on
   `status = pending, next_fire_at <= now, next_attempt_at <= now`, so a crash
   between claim and send can never duplicate a reminder. The claimed ping is
   a heads-up (`leadMinutes` before the due time), the reminder itself or an
   escalation nudge; quiet hours release the claim until the window ends
   (high priority may ring through); a transient Telegram failure releases
   the claim with `nextAttemptAt`, a permanent one keeps it.
2. `SendDailyDigestsUsecase`: morning brief, evening review, weekly wrap,
   each claimed once per user and local day (`UserRepository.claimDigest`,
   with a catch-up window after downtime). Review rows are stored on the bot
   message so it can be redrawn after each tap.

### Buttons

Inline keyboards carry short callback data; `CallbackHandler` answers every
callback exactly once, checks the task belongs to the tapping user, and edits
the message through `ignoreNotModified`. Undo records are taken atomically
(`used_at`), once.

### Your data

- Calendar feed: `GET/POST/DELETE /calendar/feed` manage `user.calendarToken`;
  `GET /calendar/<token>.ics` renders pending reminders with `common/ical.ts`
  (one-offs in UTC, series as `TZID` + `RRULE`, a snoozed occurrence as a
  `RECURRENCE-ID` override).
- Export: `POST /export` and `/export` in chat build CSV/JSON
  (`common/export-data.ts`) and the **bot sends the file as a document**
  (iOS webviews cannot download).
- Import: `POST /ai/parse-list` interprets each line separately and returns
  drafts (nothing saved); `POST /tasks/import` validates every row before
  creating any.

## Data model (as implemented in `src/domain`)

MongoDB collections: `tasks`, `users`, `bot_messages`, `conversations`,
`undo_records`. Documents use snake_case; repositories map to the camelCase
domain types below.

### Task (`domain/task/types.ts`)

| Field | Meaning |
|---|---|
| `description`, `notes` | Title and body. |
| `kind` | Derived, never stored: `todo` when `scheduledAt` is null, else `reminder`. Todos live in the Inbox and are never claimed by the scheduler. |
| `scheduledAt`, `timezone` | The current occurrence (the series time for recurring tasks) and the IANA zone the task was created in. `timezone` drives recurrence math only; **everything shown to the user is formatted in the user's current zone** (`resolveTimezone(user)`). |
| `recurrence` | `daily`, `weekdays`, `weekly` (`byWeekday`), `monthly` (`lastDayOfMonth`), `every_n_days` (`intervalDays`), `yearly`; `interval`, `until`; `anchorAt` is the occurrence the series was defined from and never moves (keeps "the 31st" on the 31st). |
| `snoozedUntil` | Moves only the current occurrence. Cleared when it completes or rolls over. |
| `leadMinutes`, `leadSentFor` | "Remind me before": the heads-up is recorded before it is sent; one claimed after the due time is sent as the reminder itself. |
| `nudgeAt`, `nudgeCount` | Escalation for an ignored reminder; reset by any new time or snooze. |
| `nextAttemptAt` | Earliest retry after a transient send failure. |
| `lastSentAt` | The claim stamp: sent when `>= nextFireAt`. |
| `status` | `pending`, `completed`, `overdue`, `deleted`. |
| `priority`, `categoryId`, `source` | `low/normal/high`; id into `user.categories`; where the task came from (`text`, `voice`, `forward`, `miniapp` + original text, message id, forwarder). |
| `completedAt`, `completions[]`, `snoozeCount` | One-shot completion; every "Done" on a recurring task (`at`, `occurrenceAt`); how often it was snoozed or delayed (the weekly wrap flags 4+). |

Two derived times are **stored** so queries can index them
(`common/fire-time.ts`):

- `due_at = snoozedUntil ?? scheduledAt` — what views and chat queries
  filter on (`TaskFilter.dueAtOrBefore/dueAfter`). Index
  `{user_id, status, due_at}`.
- `next_fire_at` — what the scheduler claims: the nudge, else the snooze,
  else the heads-up until it was sent, else the due time. Index
  `{status, next_fire_at}`. Never filter views on it: a pending heads-up or
  nudge would move a task between days. On the wire `nextFireAt` is the due
  time.

### User (`domain/user/types.ts`)

`telegramUserId`, names, `timezone` (null until detected; `OWNER_TIMEZONE`
is the fallback), `settings` (`hour12`, `weekStartsOn`, `defaultView`,
`morningBrief`, `eveningReview`, `quietHours`, `escalation.stepsMinutes`,
`weeklyWrap`; defaults in `DEFAULT_USER_SETTINGS`), `categories` (null until
first opened, then the five defaults; each `name`, `emoji`, `color`,
`keywords`), `calendarToken` (null = feed off; partial unique index).

### Conversation memory (`domain/conversation/types.ts`)

- `bot_messages`: which tasks a bot message is about (`kind`: reminder,
  confirmation, agenda) plus the evening-review rows; unique on
  `{chat_id, message_id}`, TTL 45 days.
- `conversations`: one per chat: `pendingQuestion` (with the exchange so
  far), `pendingForward`, `lastTaskIds` (what "it" refers to).
- `undo_records`: `label`, task `snapshots` (enough to put a task back),
  `createdTaskIds` (deleted on undo), `expiresAt`, `used_at`; TTL one day.

## The HTTP contract loop

```
src/contract/remy-contract.ts            zod, no other imports; CONTRACT_VERSION
   │  backend: ZodValidationPipe validates bodies; http/mappers produce wire.* types;
   │           controller specs assert responses with wire.Task.parse(...)
   ▼
npm run contract:sync   →  ../remy-webapp/src/shared/api/contract.gen.ts  (verbatim + hash banner)
npm run contract:check  →  fails when that copy is stale (part of `npm run check`
                           here, `pnpm check` there, and the `contract` CI job)
```

Changing an endpoint means: edit the contract first, bump
`CONTRACT_VERSION` when the change is breaking, run `contract:sync`, and say
so in the final message so the frontend session picks it up.

## Configuration

Everything comes from environment variables parsed once by the zod schema
in `src/common/config/env.ts` (`getEnv()`); a missing or malformed value
stops the boot with the full list of problems. `.env.example` documents
every variable. Production refuses `DEV_ALLOW_MOCK_INITDATA` and an empty
`CORS_ORIGINS`.

## Runtime and deployment

### One process, two ways to receive updates

| `BOT_MODE` | How updates arrive | Needs |
|---|---|---|
| `polling` (default) | `@grammyjs/runner` long polling, updates handled concurrently. `deleteWebhook` runs first so a stale webhook cannot break `getUpdates`. | Outbound HTTPS only. |
| `webhook` | Telegram POSTs to `WEBHOOK_URL`; this process serves `POST <path of WEBHOOK_URL>` on the Express instance (outside `/api/v1`, no JWT guard or throttler), rejects any request whose `X-Telegram-Bot-Api-Secret-Token` is not `WEBHOOK_SECRET`, answers within 10 s while slow updates finish in the background, and calls `setWebhook` on boot. | A public https URL (reverse proxy in front) and both variables. |

The HTTP API, the scheduler and MongoDB are the same in both modes.
`enableShutdownHooks` makes SIGTERM stop the runner (polling), drain
in-flight HTTP requests (webhook and API), wait for a reminder run that is
mid-send, and close Mongo.

### Docker

`Dockerfile`: node:22-alpine, three stages (production dependencies, `nest
build` with type check + SWC into `build/`, a non-root runtime that runs
`node build/main`, the same as `npm run start:prod:api`). `HEALTHCHECK`
probes `/api/v1/health`, which answers 503 while MongoDB or Telegram is
unreachable. `docker-compose.yml` has Mongo for development and an `app`
service behind the `app` profile (`npm run docker:up`) that builds the image,
reads `.env` and points `MONGODB_URI` at the `mongo` service.

### Observability

pino through `nestjs-pino`: JSON in production, pretty in development,
silent in tests (`LOG_LEVEL` overrides). Every HTTP request carries a
request id (`x-request-id`, echoed back); credentials (`Authorization`,
initData, the webhook secret header, the calendar token in feed URLs) are
redacted. Successful `/health` probes are not logged. `GET /api/v1/health`
reports `{ status, checks: { mongo, telegram } }`.

### CI

`.github/workflows/ci.yml`: on push and pull requests, Node 22, `npm ci`,
typecheck, lint, unit tests, `test:int` and `test:e2e` (mongodb-memory-server
binary cached under `~/.cache/mongodb-binaries`), and a second job that
checks out the Mini App repo and runs the contract check against its copy.

## Tests

| Layer | Command | Proves |
|---|---|---|
| Unit (`*.spec.ts` next to the code) | `npm test` | Use cases with mocked repositories/gateways, the interpreter guards against recorded model outputs, recurrence and fire-time math, env parsing, the bot service's mode switch and webhook secret check. |
| Integration (`test/*.int-spec.ts`) | `npm run test:int` | Repositories against a real in-memory MongoDB: the atomic claim under concurrency, snooze re-arming, views, digest claims, undo taken once. |
| End-to-end (`test/api.e2e-spec.ts`) | `npm run test:e2e` | The real `AppModule` over HTTP with only Telegram and OpenAI stubbed; every response parsed with the contract. |

Mocks cannot catch driver behaviour (Mongoose 9's `updatePipeline`
requirement was found by the integration suite), so anything that changes a
query or an endpoint gets a case there too.
