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
npm run check          # typecheck + lint + tests — run before finishing any task
npm test               # jest unit tests (mocks only, no DB/network)
npm run test:int       # repository vs real in-memory MongoDB (claim query, views, backfill)
npm run test:e2e       # real AppModule over HTTP vs in-memory MongoDB, contract-checked
npm run typecheck      # tsc --noEmit
npm run lint           # eslint --fix
npm run build          # SWC build into build/ ; start with npm run start:prod:api
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
  controllers, DTOs (class-validator), guards, exception filter.
- `common/config/env.ts` — **the only place that reads `process.env`**. Use
  `getEnv()`; add new variables to the zod schema and to `.env.example`.

Flow: message → `MessageHandler` → `ProcessTextMessageUsecase` →
`TaskParserGateway` → `TaskRepository`. Cron each minute →
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
  `formatForUserShort` (`common/format-date.ts`) with the task's `timezone`.
  Never call plain date-fns `format()` for user-facing text (it formats in
  the server's zone).
- Task model v2: `description` is the title, `notes` the body; a task with
  `scheduledAt: null` is a **todo** (`kind` is derived, never stored) and is
  never claimed by the scheduler; `priority` low/normal/high; `categoryId`
  points into `user.categories`; `source` records where it came from;
  `completedAt` for one-shots, `completions[]` for recurring Done taps;
  `leadMinutes` is stored but its delivery lands in Phase 3.
- `scheduledAt` is the current occurrence (series time for
  recurring tasks); `snoozedUntil` moves only the current occurrence;
  `nextFireAt = snoozedUntil ?? scheduledAt` is derived in the repository and
  is what the scheduler queries; `recurrence.anchorAt` never moves.
- Scheduler: claim first (`claimDueReminder`, atomic), send second; transient
  failures release the claim with `nextAttemptAt`, permanent ones keep it.
- Recurrence math (`common/recurrence.ts`) runs on the task's wall clock via
  date-fns-tz; always pass the task timezone.
- The parser asks the model for local wall-clock time (`scheduledAtLocal`)
  and converts with `fromZonedTime`; `interpretModelOutput` validates it.
- Bot handlers build EnsureUser input with `toEnsureUserInput()` and pick the
  zone with `resolveTimezone()` (`infrastructure/bot/user-input.ts`).
- Callbacks are answered exactly once in `CallbackHandler.handle`; message
  edits go through `ignoreNotModified`.
- `noUncheckedIndexedAccess` is on: index access returns `T | undefined`.
- Don't edit `../remy-webapp` from a backend task unless explicitly asked; the
  HTTP contract is documented in that repo's `src/shared/api/CLAUDE.md`. When
  you change a DTO, say so in the final message.

## Single-owner mode and dev bypass

- `OWNER_TELEGRAM_ID` — bot middleware and both HTTP guards reject anyone
  else.
- `DEV_ALLOW_MOCK_INITDATA=true` (never in production) — `InitDataGuard`
  accepts the frontend's mocked initData (`hash=dev-mock-hash`) so the Mini
  App works from a plain browser.

## Plan

Roadmap, bug list and design: `../remy-plan/` (`remy.html` readable version,
`PLAN.md` technical version).
