# 10 — Release evidence and remaining gates

This checklist distinguishes local code from verified service behavior. Do not mark external checks complete based on FakePayPal or test vision results.

## Local commands

- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build:check`.
- `npm run test:e2e`: 360px and 1280px lifecycle, including checkout return refresh, conflict resolution, explicit payout dialog, receipt refresh, and a balanced $5 ledger. Local providers are isolated behind development-only guards.
- `npm run test:sandbox`: skipped unless `RUN_SANDBOX_TESTS=1`; requires a freshly approved $1 sandbox order.
- `npm run audit:repo`: signature scan of source and Git history; manual review is still required.

## Edge-case assertion map

| Spec IDs | Test file and behavior |
| --- | --- |
| EC-P1, P2, P3, P4, P6, P7, P8, P9, P10 | `tests/unit/paypal-in.test.ts`: checkout, cancel, capture verification, refunds, overflow, expiry, signature and reconciliation assertions |
| EC-P5 | `tests/unit/release-regressions.test.ts`: deadline cancellation and exactly-once refund |
| EC-O1, O2, O3, O4, O5 | `tests/unit/agent-and-payouts.test.ts`: approval, send/retry, failed recipient, missing recipient, and ledger assertions |
| EC-O6 | `tests/unit/tournament.test.ts`: frozen terms |
| EC-R1, R2, R3, R4, R5, R6, R7, R10, R11, R12, R13, R14 | `tests/unit/results-and-vision.test.ts`: rule-table, malformed/transport, injection-as-data, upload authorization and resolution assertions |
| EC-R5, R8, R9 | `tests/unit/agent-and-payouts.test.ts`: timeouts, crash hooks and concurrent ticks |
| EC-S1 | `tests/unit/tournament.test.ts`: every state transition pair |
| EC-A1, A2, A3, A4 | `tests/unit/auth.test.ts`, `results-and-vision.test.ts`, `release-regressions.test.ts`: role, session, origin, disabled demo and ownership |
| EC-A5 | `tests/unit/agent-and-payouts.test.ts`: wrong/missing sweep secret |
| EC-S2 (parser acceptance) | `tests/unit/parse-tournament.test.ts` and `release-regressions.test.ts`: unsupported requests, model normalization, malformed fallback |
| Additional release boundaries | `tests/unit/release-regressions.test.ts`: bot concurrency/idempotency, seed reruns, zero-pool rejection, actual stored images, private read permissions, public redaction, Data API RLS, $5-funded complete lifecycle |

## External release gates — pending credentials

- [ ] Create sandbox business REST app and personal buyer/recipient accounts; fund sandbox business balance and confirm Payouts permission.
- [ ] Configure `.env.local` without sharing secrets in chat. Set eight demo recipient emails; they must resolve to the sandbox accounts used for payout acceptance.
- [ ] Run `npm run sandbox:check`; record order, capture and settled payout batch IDs plus human receipt confirmation (T-031).
- [ ] Run `npm run vision:check`; verify real screenshot extraction with the account's configured model.
- [ ] Run the gated sandbox suite with a fresh approved order; record pass/fail and any PayPal quirks.
- [ ] Apply migrations to the intended Supabase database with a privileged server connection; configure and verify a private screenshot bucket.
- [ ] Deploy Render Blueprint, set web/cron secrets and APP_URL, seed identities, and register the real sandbox webhook.
- [ ] Test a real webhook signature, duplicate delivery, and cron sweep; observe reconciliation and timeout handling.
- [ ] Fresh browser: run the hosted flow including at least one actual sandbox capture, real vision extraction, a host ruling, approved payout, receipt and balanced ledger.
- [ ] Keyboard, screen-reader spot check, reduced motion, and all screens at 360/768/1280px on the hosted app.
- [ ] Clean clone `npm ci`, migration, seed, checks and setup verification; inspect history for secrets and confirm public repository/license.

## Deployment details

`render.yaml` builds with `npm ci`, runs `db:migrate` before starting, checks `/api/health`, and sweeps every minute. Run `storage:setup` once with the service role key. RLS is enabled without browser policies on all ten application tables because custom Umpra JWTs are not Supabase Auth tokens. Use the privileged database connection for server queries. Never expose the database URL or service role key to clients.

The test server is not a deployable demo: `UMPRA_E2E=1` requires development, in-memory Postgres, loopback APP_URL and exact test credentials; production attempts refuse. Hosted demos use actual PayPal, Supabase and Anthropic providers.

## Submission gates

- [ ] Obtain permission to publish 2–3 real organizer/player quotes; include attribution agreed by each person.
- [ ] Fill the live demo/repository/video URLs in Devpost after they exist.
- [ ] Rehearse and record the video under three minutes using sandbox accounts; no third-party game assets or unlicensed music.
- [ ] Review individual eligibility and current official rules, then submit.

Official deadline checked November 1, 2026: **November 12, 2026, 12:00 noon PST = 21:00 Africa/Lagos**. Aim for November 11. Source: [official rules](https://paypalaihackathon.devpost.com/rules). Eligibility and prize receipt remain a human review; this date check is not an eligibility determination.
