# CLAUDE.md

Guidance for Claude Code when working in this repository (the Remy backend).

## What this is

Backend of **Remy**, a single-owner AI reminder assistant for Telegram:
NestJS 11 + grammY (bot) + MongoDB (mongoose) + OpenAI, plus an HTTP API under
`/api/v1` consumed by the Telegram Mini App in the sibling repo
`../remy-webapp` (separate git repo, talks to us over HTTP only).

## Commands

```bash
npm run dev            # docker compose mongo + API watch mode (:3000)
npm run dev:api        # API watch mode only
npm run dev:all        # Mongo + API + ../remy-webapp dev server in one terminal (--tunnel, --no-web)
npm run check          # typecheck + lint + tests — run before finishing any task
npm test               # jest unit tests (mocks only, no DB/network)
npm run test:int       # repository vs real in-memory MongoDB (claim query, views, backfill)
npm run test:e2e       # real AppModule over HTTP vs in-memory MongoDB, contract-checked
npm run typecheck      # tsc --noEmit
npm run lint           # eslint --fix
npm run build          # SWC build into build/ ; start with npm run start:prod:api
npm run docker:up      # build + run the backend container next to Mongo (compose profile app)
npm run seed           # sample day for the owner (--reset, --dry-run); needs OWNER_TELEGRAM_ID
npm run contract:sync  # regenerate the frontend's copy of the HTTP contract
```

Pre-commit runs eslint + prettier on staged `.ts` via husky/lint-staged.

## Architecture (Clean Architecture)

Path aliases: `@domain`, `@usecases`, `@infra`, `@application`, `@common` →
`src/<layer>/`.

- `domain/` — types, repository/gateway **interfaces**, domain errors. No Nest,
  no mongoose, no grammY here.
- `usecases/<area>/<name>/` — `usecase.ts`, `types.ts`, `usecase.spec.ts`,
  `index.ts`. Injected via `Symbol.for` tokens from `@common/tokens`.
- `infrastructure/` — `mongodb/` (schemas + repository impls), `openai/`
  (parser + transcription gateways), `bot/` (grammY service + handlers),
  `scheduler/` (cron).
- `application/common/*` — Nest modules; `application/common/http/` —
  controllers, zod request validation (`ZodValidationPipe` + the contract),
  mappers, guards, exception filter.
- `common/config/env.ts` — **the only place that reads `process.env`**. Use
  `getEnv()`; add new variables to the zod schema and to `.env.example`.
- `docs/ARCHITECTURE.md` — flows, data model, contract loop, deploy modes
  (`BOT_MODE=polling|webhook`, Docker, `/health`, CI). Keep it current when
  one of those changes.

Flow: message → `MessageHandler` → `AssistantResponder` →
`HandleMessageUsecase` → `InterpreterGateway` (intent) → task use cases →
`presentAssistantResult` (all Telegram formatting). The Mini App's NL create
(`/ai/parse`, `POST /tasks`, voice) goes `ParseTaskUsecase` → the same
`InterpreterGateway`; no create intent → `NotATaskError` (422). Cron each minute →
`SendPendingRemindersUsecase` → `NotificationGateway`. Buttons →
`CallbackHandler`.

## The HTTP contract

`src/contract/remy-contract.ts` is the single source of truth for every
request and response shape (zod, no other imports). The backend validates
bodies with it (`ZodValidationPipe`) and maps domain objects to `wire.*`
types (`http/mappers`); controller specs assert responses with
`wire.Task.parse(...)`. The frontend gets a verbatim generated copy:

```bash
npm run contract:sync    # writes ../remy-webapp/src/shared/api/contract.gen.ts
npm run contract:check   # fails if that copy is stale (part of npm run check)
```

Any change to an endpoint = edit the contract first, bump `CONTRACT_VERSION`
when it is breaking, run `contract:sync`, and mention it in the final message.
The domain layer must not import the contract; the HTTP layer maps.

## Rules

- Keep layers clean: use cases depend on domain interfaces only; grammY and
  mongoose types never leak into domain or use cases.
- Every use case gets a spec with mocked repositories/gateways
  (`@test/factories`). Anything that changes a Mongo query or adds an
  endpoint also gets a case in `test/task-repository.int-spec.ts` or
  `test/api.e2e-spec.ts`: mocks cannot catch driver behaviour (the Mongoose 9
  `updatePipeline` requirement was found this way). Run `npm run check`, and
  `test:int` + `test:e2e` when persistence or HTTP changed, before you finish.
- Bot messages use `parse_mode: 'HTML'` and `escapeHtml()` from
  `infrastructure/bot/html.ts` for any user-provided text. Never Markdown.
- Every time shown to the user goes through `formatForUser` /
  `formatForUserShort` (`common/format-date.ts`) with the **user's current
  zone** (`resolveTimezone(user)` / `zoneOf(user)`), never `task.timezone`:
  the owner decided (23 Sep 2026) that bot and Mini App show everything in
  the zone they live in now. `task.timezone` is for recurrence math only.
  Never call plain date-fns `format()` for user-facing text (it formats in
  the server's zone).
- Task model v2: `description` is the title, `notes` the body; a task with
  `scheduledAt: null` is a **todo** (`kind` is derived, never stored) and is
  never claimed by the scheduler; `priority` low/normal/high; `categoryId`
  points into `user.categories`; `source` records where it came from;
  `completedAt` for one-shots, `completions[]` for recurring Done taps;
  `snoozeCount` counts snoozes/delays (the weekly wrap flags 4+).
- `scheduledAt` is the current occurrence (series time for recurring tasks);
  `snoozedUntil` moves only the current occurrence; `recurrence.anchorAt`
  never moves. Two derived, stored times: `due_at = snoozedUntil ??
  scheduledAt` (what views and chat queries filter on: `TaskFilter.dueAt*`)
  and `next_fire_at` (what the scheduler claims: nudge, else snooze, else the
  heads-up until sent, else due; `common/fire-time.ts`). Never filter views
  on `next_fire_at`: a pending heads-up or nudge would move a task between
  days. A new time or snooze resets `nudgeAt`/`nudgeCount`.
- Scheduler: claim first (`claimDueReminder`, atomic), send second; transient
  failures release the claim with `nextAttemptAt`, permanent ones keep it.
- Recurrence math (`common/recurrence.ts`) runs on the task's wall clock via
  date-fns-tz; always pass the task timezone.
- The parser asks the model for local wall-clock time (`scheduledAtLocal`)
  and converts with `fromZonedTime`; `interpretModelOutput` validates it.
- Bot handlers build EnsureUser input with `toEnsureUserInput()` and pick the
  zone with `resolveTimezone()` (`infrastructure/bot/user-input.ts`).
- The assistant: prompt in `infrastructure/openai/assistant/prompt.ts`, strict
  schema in `schema.ts`, and **all trust decisions in `interpret-output.ts`**
  (pure, unit-tested with model-output fixtures). When the model misbehaves,
  add a fixture there and a guard, not just prompt text. Never let the model
  do clock arithmetic (`in_minutes`), never act on an ungrounded target. After
  changing the prompt or schema run `npm run assistant:try` (real OpenAI call;
  `ASSISTANT_DEBUG=1` prints the raw model JSON).
- Clarifying questions: a pending question keeps the whole exchange
  (`originalText` + `answered[]`), and the gateway sends it to the model as
  real chat turns (`exchangeMessages`). Never send a bare answer ("17:00") on
  its own: the model reads it as a new request and the task loses its time.
  At most `MAX_QUESTION_ROUNDS` questions per request; a tapped answer
  (`answersPendingQuestion`) ignores the typing TTL. Guards in
  `interpret-output.ts`: a create that drops a clock time the user named
  becomes a question, a named weekday wins over the model's date, the prompt
  carries a 14-day calendar.
- Conversation memory (`domain/conversation`): bot message → task links (so
  replies work), one pending question, one pending forward, last touched
  tasks, and Undo records (taken atomically, once). Record the undo BEFORE
  acting.
- "Remind me before": the heads-up is recorded (`leadSentFor`) before it is
  sent; one that is claimed after the due time (quiet hours, downtime) is
  sent as the reminder itself. On the wire `nextFireAt` is the due time.
- Scheduler pings (`SendPendingRemindersUsecase`): heads-up / due / nudge,
  quiet hours release the claim until the window ends, escalation schedules
  the next nudge after each send. Digests (`usecases/rhythm`): brief, review,
  wrap, claimed once per local day via `UserRepository.claimDigest`; review
  rows are stored on the bot message (`saveReview` / first-wins
  `resolveReviewItem`) so the message can be redrawn after each tap.
- Inline keyboards: never leave a trailing empty `row()` (build rows with
  "row() before every item but the first").
- Your data (`usecases/data`, `DataModule`): the calendar feed is
  `GET /calendar/<token>.ics`, **the only route without auth**; the 32-byte
  token in the path is the credential (`user.calendarToken`, partial unique
  index; POST `/calendar/feed` replaces it, DELETE turns it off, and every
  bad/old token is the same 404). The `.ics` is built by `common/ical.ts`
  (pure; one-offs in UTC, series with `TZID` + RRULE, a snoozed occurrence
  as a RECURRENCE-ID override). Exports (`common/export-data.ts`, CSV with
  BOM and formula-neutralised cells, or JSON) are **sent by the bot as a
  document** (`NotificationGateway.sendDocument`): Mini Apps can't download
  files reliably on iOS. `/export` does the same from the chat. List import
  is two steps: `POST /ai/parse-list` returns drafts (nothing saved; the
  interpreter reads **each line separately**, because on a whole list
  gpt-4o-mini dropped times), then `POST /tasks/import` validates every
  row before creating any.
- Callbacks are answered exactly once in `CallbackHandler.handle`; message
  edits go through `ignoreNotModified`.
- `noUncheckedIndexedAccess` is on: index access returns `T | undefined`.
- Don't edit `../remy-webapp` from a backend task unless explicitly asked; the
  HTTP contract is documented in that repo's `src/shared/api/CLAUDE.md`. When
  you change a DTO, say so in the final message.

## Logging

- Log through Nest's `Logger` (`private readonly logger = new
  Logger(MyClass.name)`), never `console.*`: `app.useLogger` routes it to
  pino (`nestjs-pino`, options in `application/common/logging/logger.options.ts`).
  JSON in production, pretty in development, silent in tests; `LOG_LEVEL`
  overrides.
- Every HTTP request has a request id (`x-request-id`, kept from the caller
  when short and safe, echoed in the response); lines logged while handling
  it carry `reqId`. Successful `/health` probes are not logged; 4xx log as
  warn, 5xx as error.
- Never log credentials: `Authorization`, initData, the webhook secret header
  and the calendar feed token are redacted by configuration, but a message
  string you build yourself is not, so keep user tokens and full initData out
  of it. Log a reason, not the raw payload.
- Log when something happened (sent, failed, held), not on every tick.

## Single-owner mode and dev bypass

- `OWNER_TELEGRAM_ID` — bot middleware and both HTTP guards reject anyone
  else.
- `DEV_ALLOW_MOCK_INITDATA=true` (never in production) — `InitDataGuard`
  accepts the frontend's mocked initData (`hash=dev-mock-hash`) so the Mini
  App works from a plain browser.

## Plan

Roadmap, bug list and design: `../remy-plan/` (`remy.html` readable version,
`PLAN.md` technical version).
