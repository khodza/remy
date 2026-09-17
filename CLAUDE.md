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
npm run typecheck      # tsc --noEmit
npm run lint           # eslint --fix
npm run build          # SWC build into build/ ; start with npm run start:prod:api
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

## Rules

- Keep layers clean: use cases depend on domain interfaces only; grammY and
  mongoose types never leak into domain or use cases.
- Every use case gets a spec with mocked repositories/gateways. Run
  `npm run check` before you finish.
- Bot messages use `parse_mode: 'HTML'` and `escapeHtml()` from
  `infrastructure/bot/html.ts` for any user-provided text. Never Markdown.
- Times shown to the user must be in the user's timezone (currently a known
  bug; Phase 1 of the plan fixes it). Do not add new server-local `format()`
  calls.
- Recurrence: `common/recurrence.ts` (`computeNextOccurrence`,
  `computeLatestOccurrence`, `describeRecurrence`). Known limitations
  documented in `recurrence.spec.ts`.
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
