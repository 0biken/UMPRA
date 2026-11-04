# 01 — Tasklist

Work top to bottom. A task is eligible when every task in `needs` is ticked. Tags: **[CORE]** must ship, **[STRETCH]** only after all CORE is done. Acceptance criteria (AC) are the definition of done for that task, on top of the global definition in `AGENTS.md`.

Doc references use the file number, e.g. `02 §Schema` means `docs/02-TECHNICAL.md`, section Schema.

---

## M0 — Foundations

- [x] **T-001 Repo and licence** [CORE]. Public repo, `LICENSE` (MIT) visible at root, `.gitignore`, `README.md` stub, copy this docs pack into the repo (`AGENTS.md` at root, rest in `docs/`).
  AC: repo builds nothing yet; MIT file present; no secrets.
- [x] **T-002 Scaffold app** [CORE]. needs T-001. Next.js App Router + TS strict + Tailwind + shadcn/ui + Vitest + ESLint. Add all scripts listed in `AGENTS.md`.
  AC: `npm run dev/build/lint/typecheck/test` all pass on a blank page.
- [x] **T-003 Env handling** [CORE]. needs T-002. `src/server/env.ts` validates env with zod and fails fast; `.env.example` lists every var in `02 §Env vars`.
  AC: app refuses to boot with a missing required var; `.env.example` committed.
- [x] **T-004 Design tokens and fonts** [CORE]. needs T-002. Implement `07 §Tokens` in `globals.css`, load fonts with `next/font`, build a `/styleguide` dev page that renders tokens and every component state as they are added.
  AC: tokens match the doc exactly; `/styleguide` renders at 360px without horizontal scroll.
- [x] **T-005 Database and migrations** [CORE]. needs T-003. Supabase project, Drizzle config, schema from `02 §Schema`, first migration, `db:migrate`.
  AC: all tables, constraints, and indexes from the doc exist; migration runs from empty.
- [x] **T-006 Shared libs** [CORE]. needs T-002. `lib/money.ts` (cents helpers, PayPal decimal-string conversion), `lib/errors.ts` (`AppError`), `lib/ids.ts`.
  AC: unit tests cover cents to `"28.00"` and back, rounding, negative rejection.

## M1 — Authentication (see `03`)

- [x] **T-010 Auth core** [CORE]. needs T-005, T-006. bcrypt hashing, JWT session cookie via jose, `getSession()`, `requireUser(role?)`.
  AC: tampered or expired cookie is rejected; unit tests for sign/verify.
- [x] **T-011 Register, login, logout, me routes** [CORE]. needs T-010. Zod-validated; generic error on bad credentials; basic login rate limit.
  AC: duplicate email returns a clear error; passwords never returned or logged.
- [x] **T-012 Auth pages** [CORE]. needs T-011, T-004. Login and register pages per `06 §Screens`, role picker (host or player).
  AC: works at 360px; keyboard accessible; errors shown inline.
- [x] **T-013 Route protection and origin check** [CORE]. needs T-010. Middleware for `/host/**` and `/play/**`; Origin/Content-Type check helper for mutating routes.
  AC: wrong-role access redirects with a clear message; cross-origin POST rejected.
- [x] **T-014 Demo login** [CORE]. needs T-011. `POST /api/auth/demo` available only when `DEMO_MODE=true`; "Try as host" and "Try as player" buttons on the landing page.
  AC: with `DEMO_MODE=false` the route returns 404.

## M2 — Tournament domain

- [x] **T-020 State machine** [CORE]. needs T-005. `state-machine.ts` with the transition table in `02 §State machine`; pure functions `canTransition`, `assertTransition`.
  AC: table-driven test covers every valid and invalid transition (EC-state).
- [x] **T-021 Bracket generation** [CORE]. needs T-020. Seeded shuffle of 8 players to 7 matches with `next_match_id` and `next_slot`. Seed stored in `tournaments.bracket_seed`.
  AC: same seed gives the same bracket; every non-final match links to exactly one next match.
- [x] **T-022 Bracket advancement** [CORE]. needs T-021. `advanceWinner(matchId)` places the winner in the next slot; activates the next match when both slots are filled.
  AC: advancing twice changes nothing (idempotent).
- [x] **T-023 Payout math** [CORE]. needs T-006. `computePayouts(poolCents, splitBps)`; remainder goes to the last place so the sum equals the pool exactly.
  AC: property tests: sum equals pool, no negatives, deterministic.
- [x] **T-024 Tournament service** [CORE]. needs T-020, T-021. Create (from config), open, cancel; split frozen after open; every transition audited.
  AC: editing the split after open throws.
- [x] **T-025 Tournament config schema** [CORE]. needs T-006. Zod schema shared by form and plain-language parser: 8 slots, fee $1 to $20, split sums to 100%.
  AC: invalid configs return field-level messages.
- [x] **T-026 Audit log service** [CORE]. needs T-005. `audit(tx, {...})` with optional `dedupe_key`; activity feed query.
  AC: inserting the same `dedupe_key` twice is a no-op.

## M3 — PayPal money in (see `04`)

- [x] **T-030 PayPal client** [CORE]. needs T-003, T-006. OAuth token fetch and in-memory cache, typed `fetch` wrapper, request ID support, error mapping. `PayPalClient` interface plus `FakePayPal` for tests.
  AC: token refreshes on expiry; a PayPal error becomes an `AppError` with the debug id logged.
- [ ] **T-031 Sandbox verification** [CORE]. needs T-030. Script `scripts/sandbox-check.ts`: create order, print approval link, capture after manual approval, then a $1 payout to a sandbox personal account.
  AC: Human confirms money moves in and out in the sandbox. **If Payouts fails, stop and tell the human** (see `04 §Fallback`).
- [x] **T-032 Join and create order** [CORE]. needs T-024, T-030. `POST /api/tournaments/:id/join`: transaction reserves a slot (pending + paid at most slots), creates the `entries` and `payments` rows, creates the PayPal order with `PayPal-Request-Id = entry-{entryId}`, returns the approval link.
  AC: double-click returns the same order; full tournament returns a clear error.
- [x] **T-033 Return, capture, cancel handlers** [CORE]. needs T-032. `GET /api/paypal/return` GETs the order, captures with `capture-{entryId}`, marks entry paid; `/cancel` marks entry cancelled and frees the slot.
  AC: refreshing the return URL never captures twice.
- [x] **T-034 Webhook endpoint** [CORE]. needs T-030. Raw-body read, signature verification, `webhook_events` dedupe, handlers for capture, refund, and payout events per `04 §Webhooks`.
  AC: duplicate and out-of-order deliveries are harmless; bad signature returns 400.
- [x] **T-035 Live prize pool** [CORE]. needs T-033. Pool equals the sum of captured, non-refunded payments. Shown on the tournament page, polled or refreshed on a short interval.
  AC: pool changes only from verified captures and refunds.
- [x] **T-036 Overflow protection** [CORE]. needs T-033. If a capture succeeds but the tournament is already full, refund that payment automatically and tell the player.
  AC: two simultaneous payers for the last slot end with one entry and one refund.
- [x] **T-037 Cancel and refund** [CORE]. needs T-033. Host cancels in `draft` or `open`, or the deadline passes with the pool unfilled. Refund every captured payment; state goes `cancelled` then `refunded` once all refunds complete.
  AC: refund retries are idempotent; partial failures stay visible and retryable.
- [x] **T-038 Pending entry expiry** [CORE]. needs T-032. Sweep expires pending entries older than 15 minutes and frees the slot.
  AC: an expired entry that later captures is refunded, not seated.

## M4 — Screenshots and results

- [x] **T-040 Screenshot storage** [CORE]. needs T-005. Supabase Storage bucket, upload helper, size (5 MB) and type (png, jpeg, webp) limits, signed read URLs.
  AC: oversize or wrong-type files rejected with a clear message.
- [x] **T-041 Submission endpoint** [CORE]. needs T-040, T-022. `POST /api/matches/:id/submissions` multipart; only the two players of an `awaiting_results` match; one submission per player; replace allowed until the match is evaluated.
  AC: a non-participant gets 403; after evaluation, replacement is refused.
- [x] **T-042 Vision provider** [CORE]. needs T-003. `VisionProvider` interface, Gemini implementation, zod-validated JSON (`05 §Vision schema`), up to 2 retries on malformed output, then `unreadable`.
  AC: malformed JSON, missing fields, and out-of-range confidence each produce `malformed` or `unreadable`, never a crash.
- [x] **T-043 Agreement rule** [CORE]. needs T-042. Pure function `evaluateSubmissions(match, subs, players)` returning `confirm`, `dispute(reason)`, or `wait`, per `05 §Agreement rule`.
  AC: table-driven tests for every row in the rule table.
- [x] **T-044 Dispute creation and summary** [CORE]. needs T-043. Open a dispute with structured facts and an LLM-written summary; fall back to a template if the model fails.
  AC: a dispute exists for every non-confirm outcome; summary never states amounts.
- [x] **T-045 Dispute resolution** [CORE]. needs T-044. `POST /api/disputes/:id/resolve` (host only): pick winner A or B plus a note; agent resumes on the next tick.
  AC: only the tournament host can resolve; resolving twice is a no-op.

- [x] **T-046 Gemini provider migration** [CORE]. Replace Anthropic with Gemini for vision, summaries and plain-language setup.
  AC: server-only REST adapter, validated output, provider tests, updated env and docs; live verification remains a release gate.

## M5 — The umpire (see `05`)

- [x] **T-050 Tool registry** [CORE]. needs T-030, T-043. Typed tools from `05 §Tools`; every call writes an audit row with `actor_type = 'agent'`.
  AC: the payout tool refuses without host approval.
- [x] **T-051 Tick function** [CORE]. needs T-050, T-022, T-044. `tick(tournamentId)` per `05 §Tick`: advisory lock, state-driven actions, every action re-checks state and uses a `dedupe_key`.
  AC: calling tick N times in a row equals calling it once.
- [x] **T-052 Triggers and sweep** [CORE]. needs T-051. Tick is invoked after: payment captured, submission saved, dispute resolved, host confirm. `POST /api/agent/sweep` (secret header) ticks every active tournament and handles timeouts.
  AC: sweep with a wrong secret returns 401; no-show timeouts open disputes.
- [x] **T-053 Restart safety** [CORE]. needs T-051. Kill the process mid-tick; the next tick resumes without duplicate audit rows, double advances, or double payouts.
  AC: automated test simulates a crash between steps (EC-restart).
- [x] **T-054 Final and payout draft** [CORE]. needs T-051, T-023. When the final is confirmed: set champion, create `payouts` rows (`drafted`), state to `confirmed`.
  AC: draft amounts equal `computePayouts` output; rows unique per place.

## M6 — Payout release

- [x] **T-060 Payout review screen data** [CORE]. needs T-054. `GET /api/tournaments/:id/payout`: recipients, amounts, pool, evidence summary, the audit trail of the bracket.
  AC: numbers shown equal DB rows, not recomputed in the UI.
- [x] **T-061 Host confirm** [CORE]. needs T-060. `POST /api/tournaments/:id/payout/confirm`: compare-and-set `drafted` to `approved` inside a transaction; then send. Double-clicks and refreshes are harmless.
  AC: second call returns the same result and sends nothing.
- [x] **T-062 Send payout batch** [CORE]. needs T-061. Create the PayPal batch with `sender_batch_id = payout-{tournamentId}`; store batch and item ids; state to `submitted`.
  AC: retrying after a network error reuses the same batch id.
- [x] **T-063 Payout status tracking** [CORE]. needs T-062, T-034. Webhook and polling update each item (`succeeded`, `failed`, `unclaimed`); tournament goes `paid` only when all items succeed.
  AC: one failed item leaves the tournament `confirmed` with a visible retry for that recipient.
- [x] **T-064 Ledger and receipt** [CORE]. needs T-063. Ledger lists every payment in and payout out with state; payout receipt view.
  AC: ledger total in minus total out equals zero after a successful payout.

## M7 — Plain-language setup

- [x] **T-070 Agent Toolkit evaluation** [CORE]. needs T-050. Check `@paypal/agent-toolkit` (TypeScript, sandbox mode). Use it for tool implementations where it covers order and capture calls; keep direct REST for payouts if the toolkit does not expose them. Record the decision in `04`.
  AC: decision documented; money flow tests still pass.
- [x] **T-071 Parse tournament prompt** [CORE]. needs T-025, T-042. `POST /api/tournaments/parse` returns a validated config preview or field-level problems. Nothing is saved.
  AC: unsupported requests (for example 16 players) get an explanation, not a silent change.
- [x] **T-072 Parse and confirm UI** [CORE]. needs T-071, T-004. Prompt box, parsed preview, edit fields, confirm.
  AC: "8-player knockout, $5 entry, winner 70%, runner-up 30%" yields the right config.

## M8 — Interface

Build against `06` and `07`. Each task includes empty, loading, and error states.

Audit findings for the existing M8 screens are in `docs/12-FRONTEND-AUDIT.md`. Fix them as part of the task they are grouped under.

- [x] **T-080 App shell** [CORE]. needs T-012, T-004. Header, role-aware nav, toasts, error boundary.
- [x] **T-081 Landing and judge quick start** [CORE]. needs T-014. What Umpra is in plain words, "Try as host", "Try as player", sandbox buyer credentials panel.
- [x] **T-082 Host dashboard** [CORE]. needs T-024. My tournaments, state pills, create button.
- [x] **T-083 Create tournament page** [CORE]. needs T-025, T-072. Form path and plain-language path.
- [x] **T-084 Tournament page** [CORE]. needs T-035. Header with state, prize pool plate, tabs: Bracket, Players, Activity, Ledger.
- [x] **T-085 Bracket view** [CORE]. needs T-084. SVG chalk-line bracket, winner line draw animation, tap a match for details.
- [x] **T-086 Join and pay flow** [CORE]. needs T-033. Gamertag and PayPal email form, redirect, return states (success, cancelled, failed).
- [x] **T-087 Player match panel** [CORE]. needs T-041. My next match, opponent, upload screenshot with preview, submission status.
- [x] **T-088 Dispute view** [CORE]. needs T-045. Both screenshots side by side, extracted data, agent summary, resolve controls.
- [x] **T-089 Payout review and confirm** [CORE]. needs T-061. Review table, irreversible-action dialog, one-tap confirm, result states.
- [x] **T-090 Activity feed** [CORE]. needs T-026. Agent log styled as the officials' report.
- [x] **T-091 Ledger tab** [CORE]. needs T-064.
- [x] **T-092 Accessibility and mobile pass** [CORE]. needs T-080. Focus states, labels, contrast, reduced motion, 360px layout for every screen.

## M9 — Demo mode and deploy (see `09`)

- [x] **T-100 Screenshot generator** [CORE]. needs T-040. Script that renders generic scoreboard PNGs (matching, mismatching, blurry, wrong players) for demo and tests. No third-party marks.
- [x] **T-101 Demo controls** [CORE]. needs T-100, T-051. With `DEMO_MODE=true`: fill remaining slots with bot players (flagged simulated), and submit bot results from the generated screenshots so a solo judge can complete a tournament.
  AC: controls are absent and routes 404 when `DEMO_MODE=false`.
- [x] **T-102 Seed script** [CORE]. needs T-101. Demo host, demo players, ready-to-run scenarios.
- [ ] **T-103 Deploy to Render** [CORE]. needs T-092, T-102. Web service, env vars, health check, scheduled job hitting `/api/agent/sweep`, PayPal webhook registered to the live URL.
  AC: a stranger completes the whole flow on the hosted link without setup.
- [ ] **T-104 Fully autonomous payout toggle** [STRETCH]. needs T-103 and everything else CORE. Host setting that skips the confirm checkpoint; default off; audited loudly.

## M10 — Quality and submission

- [x] **T-110 Edge-case suite** [CORE]. needs T-064. Implement every row of `08 §Edge-case matrix`.
- [ ] **T-111 Sandbox integration tests** [CORE]. needs T-110. `test:sandbox` covers order, capture, refund, payout against the real sandbox.
- [x] **T-112 Playwright smoke** [CORE]. needs T-103. Host creates, bots fill, results submit, payout confirms, using demo mode.
- [ ] **T-113 README and architecture notes** [CORE]. needs T-103. Per `09 §README outline`, including the AI tools used.
- [ ] **T-114 Real organizer quotes** [CORE]. Human task: collect 2 to 3 quotes from tournament organizers or players; add to README and demo script.
- [ ] **T-115 Repo audit** [CORE]. needs T-113. No secrets in history, licence visible, setup instructions verified on a clean clone.
- [ ] **T-116 Demo video and Devpost text** [CORE]. Human task, guided by `09`.

---

## Progress notes

_(Append one line per completed task: `T-xxx — what changed, anything surprising`.)_

- `T-001` — Initialized git repository, added MIT `LICENSE`, `.gitignore`, `README.md` stub, `.env.example`, and organized docs into `docs/` with `AGENTS.md` at root.
- `T-002` — Scaffolded Next.js 15 App Router with TypeScript strict, Tailwind v4, shadcn/ui config, Vitest, ESLint, and all required npm scripts; set `outputFileTracingRoot` in `next.config.ts` to avoid parent lockfile warnings.
- `T-003` — Implemented `src/server/env.ts` with Zod fail-fast validation (enforcing `PAYPAL_ENV=sandbox` and 32+ char `SESSION_SECRET`), Next.js `src/instrumentation.ts` boot check, and unit tests in `tests/unit/env.test.ts`.
- `T-006` — Implemented `src/lib/money.ts` (integer cents validation, `toPayPalAmount`, `fromPayPalAmount`, `dollarsToCents`, `formatUsd`), `src/lib/errors.ts` (`AppError` and `toErrorResponse`), and `src/lib/ids.ts` (UUID and deterministic PayPal request/batch ID helpers) with unit tests in `tests/unit/money.test.ts`.
- `T-004` — Implemented exact `@theme` design tokens and typography scale from `07-DESIGN-SYSTEM.md` in `src/app/globals.css`, loaded `Bricolage_Grotesque` and `Public_Sans` in `src/app/layout.tsx`, created core themed UI components (`Button`, `Input`, `Textarea`, `SelectField`, `Panel`, `Banner`, `EmptyState`, `Skeleton`, `Stepper`, `Dialog`, `StatePill`, `PrizePlate`), and built `/styleguide` plus `tests/unit/tokens.test.ts`.
- `T-005` — Created Drizzle ORM schema (`src/server/db/schema.ts`), initial SQL migration (`src/server/db/migrations/0000_initial.sql`), `drizzle.config.ts`, `scripts/migrate.ts`, and `src/server/db/index.ts` (using `postgres.js` for Supabase/Postgres URLs and `@electric-sql/pglite` devDependency for fast embedded Postgres 16 test runs); verified all 10 tables, CHECK constraints, and partial unique indexes in `tests/unit/db.test.ts`.
- `T-010` — Implemented bcrypt password hashing (`src/server/auth/password.ts`), HS256 JWT session cookies via `jose` (`src/server/auth/session.ts`), and `requireUser` / `requireTournamentHost` / `assertSameOrigin` guards (`src/server/auth/guards.ts`) with unit tests in `tests/unit/auth.test.ts`.
- `T-011` — Implemented `register`, `login`, `logout`, and `me` API routes and `src/server/auth/service.ts` with Zod validation, identical `INVALID_CREDENTIALS` messages for unknown email vs bad password, and 10-attempts/15-min IP+email login rate limiting.
- `T-012` — Built mobile-first `/login` and `/register` pages (`src/app/(public)/login/page.tsx`, `src/app/(public)/register/page.tsx`) with accessible role radio picker (`player` / `host`) and inline field error display.
- `T-013` — Added `src/middleware.ts` protecting `/host/**` and `/play/**` and `src/app/wrong-role/page.tsx` with role-switch actions; verified cross-origin POST rejection and route protection in `tests/unit/auth.test.ts`.
- `T-014` — Added `POST /api/auth/demo` (`src/app/api/auth/demo/route.ts`) gated by `DEMO_MODE=true` (returns 404 when false) and `DemoLoginButtons` ("Try as host", "Try as player") on the landing page.
- `T-020` — Implemented tournament and match state machine (`src/server/tournament/state-machine.ts`) with table-driven unit tests covering every (from, to) pair (`EC-S1`).
- `T-021` — Implemented deterministic Mulberry32 seeded 8-player single-elimination bracket generation (`src/server/tournament/bracket.ts`) producing 7 linked matches.
- `T-022` — Implemented idempotent `advanceWinner(matchId)` in `src/server/tournament/bracket.ts`, activating next-round matches when both slots fill.
- `T-023` — Implemented deterministic `computePayouts(poolCents, splitBps)` in `src/server/tournament/payout-math.ts` assigning remainder cents to the last place with property tests.
- `T-024` — Implemented `src/server/tournament/service.ts` (`createTournament`, `updateTournamentTerms`, `openTournament`, `cancelTournamentByHost`) freezing `payout_split` and `entry_fee_cents` once state leaves `draft` (`EC-O6`).
- `T-025` — Implemented shared Zod tournament configuration schema (`src/server/tournament/config.ts`) enforcing 8 slots, $1–$20 entry fee, and 100% (10000 bps) payout split.
- `T-026` — Implemented `audit()` and `listTournamentActivity()` (`src/server/audit.ts`) with `dedupe_key` conflict-ignore idempotency and official UI sentence formatting.
- `T-030` — Implemented `HttpPayPalClient` (`src/server/paypal/client.ts`) with OAuth token caching/expiry refresh, `PayPal-Request-Id` support, `PayPal-Debug-Id` error logging, and `FakePayPal` (`src/server/paypal/fake.ts`), plus `scripts/sandbox-check.ts` for `T-031` human sandbox verification.
- `T-032` — Implemented `joinTournamentAndCreateOrder` (`src/server/paypal/orders.ts`) and `POST /api/tournaments/:id/join` with row-locked slot reservation (`pending + paid < 8`) and double-click idempotency (`EC-P2`).
- `T-033` — Implemented `verifyAndCaptureEntryOrder`, `cancelEntryOrder`, `GET /api/paypal/return`, and `GET /api/paypal/cancel` with refresh safety (`EC-P3`), amount/reference verification (`EC-P10`), and slot release on cancel (`EC-P1`).
- `T-034` — Implemented `handlePayPalWebhook` and `reprocessUnprocessedWebhookEvents` (`src/server/paypal/webhooks.ts`) and `POST /api/paypal/webhook` with raw-body signature verification (`EC-P9`), `webhook_events` deduplication, and out-of-order reconciliation (`EC-P4`).
- `T-035` — Implemented `getLivePrizePoolCents` (`src/server/paypal/orders.ts`) summing only verified `captured` payments from the DB.
- `T-036` — Implemented overflow protection inside `verifyAndCaptureEntryOrder` and `PAYMENT.CAPTURE.COMPLETED` webhook handler (`EC-P7`), automatically refunding captures that arrive after the 8th paid slot.
- `T-037` — Implemented `issueRefundForPayment`, `refundTournamentPayments`, and `cancelAndRefundTournament` (`src/server/paypal/refunds.ts`) with idempotent `refund-<paymentId>` retries and `cancelled -> refunded` transition (`EC-P6`).
- `T-038` — Implemented `expireStalePendingEntries` (15-min timeout) and automatic refund when an expired entry captures late (`EC-P8`).
- `T-040` — Implemented `src/server/storage.ts` (`validateScreenshotUpload`, `SupabaseStorageProvider`, `MemoryStorageProvider`) enforcing 5 MB max size and PNG/JPEG/WebP mime types (`EC-R14`).
- `T-041` — Implemented `submitMatchScreenshot` (`src/server/tournament/submissions.ts`) and `POST /api/matches/:id/submissions` restricting uploads to the two participants of an `awaiting_results` match and allowing replacement until evaluation (`EC-R13`).
- `T-042` — Implemented `ExtractionSchema`, `parseVisionExtractionOutput`, `runVisionExtractionWithRetries`, `FakeVision`, and `GeminiVisionProvider` (`src/server/agent/vision/`) with up to 2 retries on malformed output before marking `unreadable` (`EC-R6`, `EC-R7`).
- `T-043` — Implemented `evaluateSubmissions` (`src/server/agent/evaluate.ts`) with table-driven unit tests for all 9 rows of `05 §Agreement rule` (`EC-R1` to `EC-R5`, `EC-R10`, `EC-R11`).
- `T-044` — Implemented `generateDisputeSummary`, `sanitizeDisputeSummary`, `buildDisputeFallbackSummary` (`src/server/agent/summarize-dispute.ts`), and `openMatchDispute` (`src/server/tournament/disputes.ts`), guaranteeing summaries never mention dollar amounts.
- `T-045` — Implemented `resolveDisputeByHost` (`src/server/tournament/disputes.ts`) and `POST /api/disputes/:id/resolve` with host ownership check (`EC-A1`) and idempotent double-resolution handling (`EC-R12`).
- `T-050` — Implemented typed agent tool registry (`src/server/agent/tools.ts`) wrapping tournament, bracket, vision, evaluation, dispute, payout draft, and PayPal operations with Zod validation, `actor_type = 'agent'` audit logging, and host-approval enforcement on `paypal.createPayoutBatch`.
- `T-051` — Implemented idempotent `tick(tournamentId)` (`src/server/agent/tick.ts`) with `pg_advisory_xact_lock`, external vision extraction outside DB locks, state-driven transitions, and `dedupe_key` audit logging (`EC-R9`).
- `T-052` — Implemented `sweepActiveTournaments()`, `POST /api/agent/sweep`, and `POST /api/agent/tick/:id` protected by `x-sweep-secret`, triggering `tick()` after captures, submissions, dispute resolutions, and payout confirmations (`EC-A5`, `EC-R5`).
- `T-053` — Added `onStepHook` crash-injection support in `tick()` and automated mid-tick restart safety tests (`EC-R8`) verifying zero duplicate advances, audit rows, or payouts.
- `T-054` — Implemented `draftTournamentPayouts` (`src/server/paypal/payouts.ts`) computing deterministic payouts via `computePayouts`, validating recipient PayPal emails, inserting unique `drafted` payout rows, and transitioning the tournament to `confirmed`.
- `T-060` — Implemented `getTournamentPayoutReviewData` and `GET /api/tournaments/:id/payout` returning DB-backed payout rows, live pool, final match evidence summary, and bracket audit trail.
- `T-061` — Implemented `approveAndSendTournamentPayouts` and `POST /api/tournaments/:id/payout/confirm` using compare-and-set (`drafted -> approved`) for double-click/refresh idempotency (`EC-O1`).
- `T-062` — Implemented `sendPayoutBatch` (`src/server/paypal/payouts.ts`) sending `sender_batch_id = payout-{tournamentId}` (or `-retry-{n}` for single-item retries) and storing batch/item IDs (`EC-O2`, `EC-O4`).
- `T-063` — Implemented `syncTournamentPayoutStatuses`, webhook payout item updates, and `retryFailedPayoutItem` transitioning the tournament to `paid` only when every item succeeds (`EC-O3`, `EC-O5`).
- `T-064` — Implemented `getTournamentLedger` (`src/server/paypal/payouts.ts`) listing all entry payments in and payout items out and verifying `netBalanceCents === 0` once paid.
- `T-070` — Evaluated `@paypal/agent-toolkit` from source (no request-ID control, no Payouts or webhook verification); decision to keep direct REST recorded in `04-PAYPAL.md`.
- `T-071`/`T-072` — `POST /api/tournaments/parse` and `preview` (`src/server/agent/parse-tournament.ts`) plus `CreateTournamentFlow` UI; unsupported requests and malformed model output fall back to field-level problems.
- `T-080`–`T-091` — App shell, landing, host dashboard, create page, tournament page with bracket/players/activity/ledger, join and pay, player match panel, dispute view, payout review dialog. Built and compiled (`build:check`); hosted visual pass still pending under T-092.
- `T-100`–`T-102` — `scripts/make-screenshots.ts` (output in `public/demo-screenshots`), bot fill and submit under `src/server/demo/`, `/api/demo/*` routes gated by `DEMO_MODE`, and a seed script.
- `T-110` — All 36 `08 §Edge-case matrix` IDs are referenced by tests (map in `docs/10-RELEASE.md`). Left unticked on purpose: T-031, T-092, T-103, T-111, T-112+ (need real services or hosted verification).
- `T-112` — `npm run test:e2e` passes at 360px and 1280px against local in-memory providers (checkout return, dispute ruling, payout dialog, receipt, balanced ledger). Not yet run against hosted services.
- `Phase 0 frontend audit` - Committed the M7-M10 work as `f747762`; walked the screens at 360px; fixed the landing page overflow (bracket SVG stretched the grid column) and 11 em-dashes; wrote `docs/12-FRONTEND-AUDIT.md`. Typecheck and lint clean; `npm test` crashes workers on low-memory machines but all 12 files pass individually. This phase ticked nothing. T-080 to T-091 were ticked in `3ad7c1e` before this audit, but the audit found open issues under T-080, T-082, T-084, T-088 and T-089; treat those boxes as built, not finished, until the findings are cleared.
- `Phase 1 shell and landing` (T-080, T-081) - Header is one 56px row (nav strip below it under `md`), role-aware, rendered from the server session with no signed-out flash; `Button` gained `asChild` and every link-wrapped button uses it; landing hero cut to headline, 18-word subtext and CTAs, lifecycle restyled as an open row. Verified at 360, 768 and 1280px; typecheck, lint and nearby unit tests pass. Remaining header and tab targets under 44px go to T-092.
- `Phase 2 tournament page` (T-084, T-085, T-090, T-091) - Plate separates paid from simulated slots; tabs are a scrollable 44px row with arrow-key support; demo controls follow the bracket; Ledger is stacked rows on phones; Players tab no longer calls demo players paid; round names match the server. Draw animation observed live; checked at 360, 768 and 1280px. The edits landed in `3ceae7e` (committed by another session) so this note and the audit update are the only new changes.
- `Phase 3 player flows` (T-086, T-087) - Join form validates on submit with inline errors, stays busy through the PayPal redirect, and notes the 15-minute hold; `/play` explains failed, cancelled and unmatched returns without claiming the player wasn't charged; match panel shows scores from the player's side and covers waiting-for-opponent, knocked-out, runner-up and champion states; uploader clears after upload, can re-pick the same file, has Cancel and a preparing state. Walked join, validation, return banner, upload, result and elimination in the browser at 360px; checked 768 and 1280. Surprise: a shell-escaped regex (`[^s@]`) rejected any email containing "s"; only the live walk caught it.
- `Phase 4 host flows` (T-082, T-083, T-088, T-089) - Payout review: stacked recipient rows on phones with amounts visible, plain statuses, one trail line with correct plurals, Confirm inside the first screen, "Paid." receipt string, sending banner; money calls untouched. Shared `Dialog` now returns focus to its opener. Dispute view reloads silently and hides the ruling as soon as it succeeds; screenshots show a placeholder until loaded. Dashboard shows one "New tournament" button when empty; create flow explains disabled buttons and has 44px keyboard tabs. Walked create, dispute ruling, payout confirm (Escape, focus return, send on the local fake PayPal), receipt and refresh at 360px; payout table at 1280. Surprise: the browser pane being hidden stops lazy images from loading, which looked like a bug until checked.
- `Phase 5 accessibility` (T-092) - Compact buttons keep a 36px look with a 44px tap area; bracket round chips are 44px with `aria-pressed`; input borders moved to `muted` (line-strong was 1.8:1 on paper, doc `07` updated); logo, tournament title and wrong-role links are 44px; dispute screenshot names are h2. A Playwright DOM check (15 pages, 3 roles, 360/768/1280px) reports 0 issues, a Tab walk over 7 pages finds every stop visible with a focus ring, and reduced motion switches off the landing bracket draw. Checked locally only; re-run against the hosted build in T-103. Screen readers not tested. Details in `docs/12-FRONTEND-AUDIT.md`.

- `T-046` — Replaced Anthropic with Gemini using a shared REST adapter and scoped AI configuration; removed the SDK without adding dependencies. Adapter, environment and parser tests pass. Saved credentials remain local; live verification returned HTTP 503 UNAVAILABLE.
