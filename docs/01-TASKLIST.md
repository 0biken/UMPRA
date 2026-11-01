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
- [ ] **T-005 Database and migrations** [CORE]. needs T-003. Supabase project, Drizzle config, schema from `02 §Schema`, first migration, `db:migrate`.
  AC: all tables, constraints, and indexes from the doc exist; migration runs from empty.
- [x] **T-006 Shared libs** [CORE]. needs T-002. `lib/money.ts` (cents helpers, PayPal decimal-string conversion), `lib/errors.ts` (`AppError`), `lib/ids.ts`.
  AC: unit tests cover cents to `"28.00"` and back, rounding, negative rejection.

## M1 — Authentication (see `03`)

- [ ] **T-010 Auth core** [CORE]. needs T-005, T-006. bcrypt hashing, JWT session cookie via jose, `getSession()`, `requireUser(role?)`.
  AC: tampered or expired cookie is rejected; unit tests for sign/verify.
- [ ] **T-011 Register, login, logout, me routes** [CORE]. needs T-010. Zod-validated; generic error on bad credentials; basic login rate limit.
  AC: duplicate email returns a clear error; passwords never returned or logged.
- [ ] **T-012 Auth pages** [CORE]. needs T-011, T-004. Login and register pages per `06 §Screens`, role picker (host or player).
  AC: works at 360px; keyboard accessible; errors shown inline.
- [ ] **T-013 Route protection and origin check** [CORE]. needs T-010. Middleware for `/host/**` and `/play/**`; Origin/Content-Type check helper for mutating routes.
  AC: wrong-role access redirects with a clear message; cross-origin POST rejected.
- [ ] **T-014 Demo login** [CORE]. needs T-011. `POST /api/auth/demo` available only when `DEMO_MODE=true`; "Try as host" and "Try as player" buttons on the landing page.
  AC: with `DEMO_MODE=false` the route returns 404.

## M2 — Tournament domain

- [ ] **T-020 State machine** [CORE]. needs T-005. `state-machine.ts` with the transition table in `02 §State machine`; pure functions `canTransition`, `assertTransition`.
  AC: table-driven test covers every valid and invalid transition (EC-state).
- [ ] **T-021 Bracket generation** [CORE]. needs T-020. Seeded shuffle of 8 players to 7 matches with `next_match_id` and `next_slot`. Seed stored in `tournaments.bracket_seed`.
  AC: same seed gives the same bracket; every non-final match links to exactly one next match.
- [ ] **T-022 Bracket advancement** [CORE]. needs T-021. `advanceWinner(matchId)` places the winner in the next slot; activates the next match when both slots are filled.
  AC: advancing twice changes nothing (idempotent).
- [ ] **T-023 Payout math** [CORE]. needs T-006. `computePayouts(poolCents, splitBps)`; remainder goes to the last place so the sum equals the pool exactly.
  AC: property tests: sum equals pool, no negatives, deterministic.
- [ ] **T-024 Tournament service** [CORE]. needs T-020, T-021. Create (from config), open, cancel; split frozen after open; every transition audited.
  AC: editing the split after open throws.
- [ ] **T-025 Tournament config schema** [CORE]. needs T-006. Zod schema shared by form and plain-language parser: 8 slots, fee $1 to $20, split sums to 100%.
  AC: invalid configs return field-level messages.
- [ ] **T-026 Audit log service** [CORE]. needs T-005. `audit(tx, {...})` with optional `dedupe_key`; activity feed query.
  AC: inserting the same `dedupe_key` twice is a no-op.

## M3 — PayPal money in (see `04`)

- [ ] **T-030 PayPal client** [CORE]. needs T-003, T-006. OAuth token fetch and in-memory cache, typed `fetch` wrapper, request ID support, error mapping. `PayPalClient` interface plus `FakePayPal` for tests.
  AC: token refreshes on expiry; a PayPal error becomes an `AppError` with the debug id logged.
- [ ] **T-031 Sandbox verification** [CORE]. needs T-030. Script `scripts/sandbox-check.ts`: create order, print approval link, capture after manual approval, then a $1 payout to a sandbox personal account.
  AC: Human confirms money moves in and out in the sandbox. **If Payouts fails, stop and tell the human** (see `04 §Fallback`).
- [ ] **T-032 Join and create order** [CORE]. needs T-024, T-030. `POST /api/tournaments/:id/join`: transaction reserves a slot (pending + paid at most slots), creates the `entries` and `payments` rows, creates the PayPal order with `PayPal-Request-Id = entry-{entryId}`, returns the approval link.
  AC: double-click returns the same order; full tournament returns a clear error.
- [ ] **T-033 Return, capture, cancel handlers** [CORE]. needs T-032. `GET /api/paypal/return` GETs the order, captures with `capture-{entryId}`, marks entry paid; `/cancel` marks entry cancelled and frees the slot.
  AC: refreshing the return URL never captures twice.
- [ ] **T-034 Webhook endpoint** [CORE]. needs T-030. Raw-body read, signature verification, `webhook_events` dedupe, handlers for capture, refund, and payout events per `04 §Webhooks`.
  AC: duplicate and out-of-order deliveries are harmless; bad signature returns 400.
- [ ] **T-035 Live prize pool** [CORE]. needs T-033. Pool equals the sum of captured, non-refunded payments. Shown on the tournament page, polled or refreshed on a short interval.
  AC: pool changes only from verified captures and refunds.
- [ ] **T-036 Overflow protection** [CORE]. needs T-033. If a capture succeeds but the tournament is already full, refund that payment automatically and tell the player.
  AC: two simultaneous payers for the last slot end with one entry and one refund.
- [ ] **T-037 Cancel and refund** [CORE]. needs T-033. Host cancels in `draft` or `open`, or the deadline passes with the pool unfilled. Refund every captured payment; state goes `cancelled` then `refunded` once all refunds complete.
  AC: refund retries are idempotent; partial failures stay visible and retryable.
- [ ] **T-038 Pending entry expiry** [CORE]. needs T-032. Sweep expires pending entries older than 15 minutes and frees the slot.
  AC: an expired entry that later captures is refunded, not seated.

## M4 — Screenshots and results

- [ ] **T-040 Screenshot storage** [CORE]. needs T-005. Supabase Storage bucket, upload helper, size (5 MB) and type (png, jpeg, webp) limits, signed read URLs.
  AC: oversize or wrong-type files rejected with a clear message.
- [ ] **T-041 Submission endpoint** [CORE]. needs T-040, T-022. `POST /api/matches/:id/submissions` multipart; only the two players of an `awaiting_results` match; one submission per player; replace allowed until the match is evaluated.
  AC: a non-participant gets 403; after evaluation, replacement is refused.
- [ ] **T-042 Vision provider** [CORE]. needs T-003. `VisionProvider` interface, Anthropic implementation, zod-validated JSON (`05 §Vision schema`), up to 2 retries on malformed output, then `unreadable`.
  AC: malformed JSON, missing fields, and out-of-range confidence each produce `malformed` or `unreadable`, never a crash.
- [ ] **T-043 Agreement rule** [CORE]. needs T-042. Pure function `evaluateSubmissions(match, subs, players)` returning `confirm`, `dispute(reason)`, or `wait`, per `05 §Agreement rule`.
  AC: table-driven tests for every row in the rule table.
- [ ] **T-044 Dispute creation and summary** [CORE]. needs T-043. Open a dispute with structured facts and an LLM-written summary; fall back to a template if the model fails.
  AC: a dispute exists for every non-confirm outcome; summary never states amounts.
- [ ] **T-045 Dispute resolution** [CORE]. needs T-044. `POST /api/disputes/:id/resolve` (host only): pick winner A or B plus a note; agent resumes on the next tick.
  AC: only the tournament host can resolve; resolving twice is a no-op.

## M5 — The umpire (see `05`)

- [ ] **T-050 Tool registry** [CORE]. needs T-030, T-043. Typed tools from `05 §Tools`; every call writes an audit row with `actor_type = 'agent'`.
  AC: the payout tool refuses without host approval.
- [ ] **T-051 Tick function** [CORE]. needs T-050, T-022, T-044. `tick(tournamentId)` per `05 §Tick`: advisory lock, state-driven actions, every action re-checks state and uses a `dedupe_key`.
  AC: calling tick N times in a row equals calling it once.
- [ ] **T-052 Triggers and sweep** [CORE]. needs T-051. Tick is invoked after: payment captured, submission saved, dispute resolved, host confirm. `POST /api/agent/sweep` (secret header) ticks every active tournament and handles timeouts.
  AC: sweep with a wrong secret returns 401; no-show timeouts open disputes.
- [ ] **T-053 Restart safety** [CORE]. needs T-051. Kill the process mid-tick; the next tick resumes without duplicate audit rows, double advances, or double payouts.
  AC: automated test simulates a crash between steps (EC-restart).
- [ ] **T-054 Final and payout draft** [CORE]. needs T-051, T-023. When the final is confirmed: set champion, create `payouts` rows (`drafted`), state to `confirmed`.
  AC: draft amounts equal `computePayouts` output; rows unique per place.

## M6 — Payout release

- [ ] **T-060 Payout review screen data** [CORE]. needs T-054. `GET /api/tournaments/:id/payout`: recipients, amounts, pool, evidence summary, the audit trail of the bracket.
  AC: numbers shown equal DB rows, not recomputed in the UI.
- [ ] **T-061 Host confirm** [CORE]. needs T-060. `POST /api/tournaments/:id/payout/confirm`: compare-and-set `drafted` to `approved` inside a transaction; then send. Double-clicks and refreshes are harmless.
  AC: second call returns the same result and sends nothing.
- [ ] **T-062 Send payout batch** [CORE]. needs T-061. Create the PayPal batch with `sender_batch_id = payout-{tournamentId}`; store batch and item ids; state to `submitted`.
  AC: retrying after a network error reuses the same batch id.
- [ ] **T-063 Payout status tracking** [CORE]. needs T-062, T-034. Webhook and polling update each item (`succeeded`, `failed`, `unclaimed`); tournament goes `paid` only when all items succeed.
  AC: one failed item leaves the tournament `confirmed` with a visible retry for that recipient.
- [ ] **T-064 Ledger and receipt** [CORE]. needs T-063. Ledger lists every payment in and payout out with state; payout receipt view.
  AC: ledger total in minus total out equals zero after a successful payout.

## M7 — Plain-language setup

- [ ] **T-070 Agent Toolkit evaluation** [CORE]. needs T-050. Check `@paypal/agent-toolkit` (TypeScript, sandbox mode). Use it for tool implementations where it covers order and capture calls; keep direct REST for payouts if the toolkit does not expose them. Record the decision in `04`.
  AC: decision documented; money flow tests still pass.
- [ ] **T-071 Parse tournament prompt** [CORE]. needs T-025, T-042. `POST /api/tournaments/parse` returns a validated config preview or field-level problems. Nothing is saved.
  AC: unsupported requests (for example 16 players) get an explanation, not a silent change.
- [ ] **T-072 Parse and confirm UI** [CORE]. needs T-071, T-004. Prompt box, parsed preview, edit fields, confirm.
  AC: "8-player knockout, $5 entry, winner 70%, runner-up 30%" yields the right config.

## M8 — Interface

Build against `06` and `07`. Each task includes empty, loading, and error states.

- [ ] **T-080 App shell** [CORE]. needs T-012, T-004. Header, role-aware nav, toasts, error boundary.
- [ ] **T-081 Landing and judge quick start** [CORE]. needs T-014. What Umpra is in plain words, "Try as host", "Try as player", sandbox buyer credentials panel.
- [ ] **T-082 Host dashboard** [CORE]. needs T-024. My tournaments, state pills, create button.
- [ ] **T-083 Create tournament page** [CORE]. needs T-025, T-072. Form path and plain-language path.
- [ ] **T-084 Tournament page** [CORE]. needs T-035. Header with state, prize pool plate, tabs: Bracket, Players, Activity, Ledger.
- [ ] **T-085 Bracket view** [CORE]. needs T-084. SVG chalk-line bracket, winner line draw animation, tap a match for details.
- [ ] **T-086 Join and pay flow** [CORE]. needs T-033. Gamertag and PayPal email form, redirect, return states (success, cancelled, failed).
- [ ] **T-087 Player match panel** [CORE]. needs T-041. My next match, opponent, upload screenshot with preview, submission status.
- [ ] **T-088 Dispute view** [CORE]. needs T-045. Both screenshots side by side, extracted data, agent summary, resolve controls.
- [ ] **T-089 Payout review and confirm** [CORE]. needs T-061. Review table, irreversible-action dialog, one-tap confirm, result states.
- [ ] **T-090 Activity feed** [CORE]. needs T-026. Agent log styled as the officials' report.
- [ ] **T-091 Ledger tab** [CORE]. needs T-064.
- [ ] **T-092 Accessibility and mobile pass** [CORE]. needs T-080. Focus states, labels, contrast, reduced motion, 360px layout for every screen.

## M9 — Demo mode and deploy (see `09`)

- [ ] **T-100 Screenshot generator** [CORE]. needs T-040. Script that renders generic scoreboard PNGs (matching, mismatching, blurry, wrong players) for demo and tests. No third-party marks.
- [ ] **T-101 Demo controls** [CORE]. needs T-100, T-051. With `DEMO_MODE=true`: fill remaining slots with bot players (flagged simulated), and submit bot results from the generated screenshots so a solo judge can complete a tournament.
  AC: controls are absent and routes 404 when `DEMO_MODE=false`.
- [ ] **T-102 Seed script** [CORE]. needs T-101. Demo host, demo players, ready-to-run scenarios.
- [ ] **T-103 Deploy to Render** [CORE]. needs T-092, T-102. Web service, env vars, health check, scheduled job hitting `/api/agent/sweep`, PayPal webhook registered to the live URL.
  AC: a stranger completes the whole flow on the hosted link without setup.
- [ ] **T-104 Fully autonomous payout toggle** [STRETCH]. needs T-103 and everything else CORE. Host setting that skips the confirm checkpoint; default off; audited loudly.

## M10 — Quality and submission

- [ ] **T-110 Edge-case suite** [CORE]. needs T-064. Implement every row of `08 §Edge-case matrix`.
- [ ] **T-111 Sandbox integration tests** [CORE]. needs T-110. `test:sandbox` covers order, capture, refund, payout against the real sandbox.
- [ ] **T-112 Playwright smoke** [CORE]. needs T-103. Host creates, bots fill, results submit, payout confirms, using demo mode.
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
