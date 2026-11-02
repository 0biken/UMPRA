# 02 — Technical document

## Architecture

```
                       ┌────────────────────────────────────────────┐
 Browser (host/player) │  Next.js app (Render web service)          │
  ───────────────────▶ │  App Router pages  +  /api route handlers  │
                       │                                            │
                       │  src/server/                               │
                       │   auth ─ tournament ─ paypal ─ agent ─ db  │
                       └───────┬───────────────┬───────────┬────────┘
                               │               │           │
                       Postgres (Supabase)   PayPal      Anthropic API
                       + Storage (screens)   sandbox     (vision + text)
                               ▲               │
                               │   webhooks    │
                               └───────────────┘
   Render cron ──▶ POST /api/agent/sweep (secret) ──▶ tick() for active tournaments
```

Principles: one Next.js app, one database, thin API routes, all logic in `src/server/**`. The agent is a deterministic orchestrator that calls an LLM only for reading screenshots, summarizing disputes, and parsing the host's plain-language description.

## Folder structure

```
src/
  app/
    (public)/page.tsx                landing + judge quick start
    (public)/login, register
    t/[id]/page.tsx                  tournament page (bracket, pool, activity, ledger)
    host/page.tsx                    host dashboard
    host/new/page.tsx                create tournament
    host/t/[id]/payout/page.tsx      payout review + confirm
    host/t/[id]/disputes/[d]/page.tsx
    play/page.tsx                    browse open tournaments
    play/t/[id]/page.tsx             join + my match
    styleguide/page.tsx              dev only
    api/
      auth/{register,login,logout,me,demo}/route.ts
      tournaments/route.ts           GET list, POST create
      tournaments/parse/route.ts
      tournaments/[id]/route.ts
      tournaments/[id]/{open,cancel,join,activity,payout}/route.ts
      tournaments/[id]/payout/confirm/route.ts
      matches/[id]/submissions/route.ts
      disputes/[id]/resolve/route.ts
      paypal/{return,cancel,webhook}/route.ts
      agent/{sweep,tick/[id]}/route.ts
      demo/{fill,submit}/route.ts
  components/
    ui/            shadcn primitives, themed
    bracket/       BracketView, MatchCard
    tournament/    PrizePlate, StatePill, PlayersList, LedgerTable, ActivityLog
    results/       ScreenshotUploader, ScreenshotCompare
  server/
    env.ts
    audit.ts
    db/{schema.ts,index.ts,migrations/}
    auth/{session.ts,password.ts,guards.ts}
    tournament/{state-machine.ts,bracket.ts,payout-math.ts,service.ts,config.ts}
    paypal/{client.ts,orders.ts,payouts.ts,refunds.ts,webhooks.ts,fake.ts}
    agent/{tick.ts,tools.ts,evaluate.ts,vision/{provider.ts,anthropic.ts,schema.ts},parse-tournament.ts,summarize-dispute.ts,prompts/}
    storage.ts
  lib/{money.ts,ids.ts,errors.ts}
scripts/{seed.ts,sandbox-check.ts,make-screenshots.ts}
tests/{unit,integration,e2e}
docs/
```

## Env vars

| Var | Required | Purpose |
|-----|----------|---------|
| `APP_URL` | yes | Absolute base URL, used in PayPal return/cancel links |
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes | 32+ random bytes for signing session JWTs |
| `PAYPAL_ENV` | yes | `sandbox` (production is forbidden in this project) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | yes | Sandbox REST app credentials |
| `PAYPAL_WEBHOOK_ID` | yes | From the webhook registered in the PayPal dashboard |
| `PAYPAL_WEBHOOK_VERIFY` | no | Default `true`. Keep true everywhere except local unit tests |
| `ANTHROPIC_API_KEY` | yes | Vision and text calls |
| `VISION_MODEL` | no | Default `claude-sonnet-5-5` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | yes | Screenshot storage |
| `AGENT_SWEEP_SECRET` | yes | Shared secret for `/api/agent/*` |
| `DEMO_MODE` | no | `true` enables demo login and demo controls |
| `MATCH_TIMEOUT_MIN` | no | Default 30. No submissions by then opens a dispute |
| `SECOND_SUBMISSION_TIMEOUT_MIN` | no | Default 15 |
| `RUN_SANDBOX_TESTS` | no | `1` enables `test:sandbox` |

`.env.example` lists all of these with empty values. Never commit real values.

## Schema

Money is integer cents. Split is stored in basis points (7000 = 70%).

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  role text not null check (role in ('host','player')),
  paypal_email text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users(id),
  title text not null,
  game text not null,
  format text not null default 'single_elimination',
  slots int not null default 8 check (slots = 8),
  entry_fee_cents int not null check (entry_fee_cents between 100 and 2000),
  currency text not null default 'USD' check (currency = 'USD'),
  payout_split jsonb not null,            -- {"1":7000,"2":3000}, sums to 10000
  state text not null default 'draft',
  bracket_seed int,
  registration_closes_at timestamptz,
  champion_id uuid references users(id),
  cancel_reason text,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  player_id uuid not null references users(id),
  gamertag text not null,
  status text not null default 'pending'
    check (status in ('pending','paid','cancelled','expired','refunded')),
  simulated boolean not null default false,      -- demo bots only
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id),
  unique (tournament_id, gamertag)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  entry_id uuid not null unique references entries(id),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  amount_cents int not null,
  status text not null default 'created'
    check (status in ('created','approved','captured','failed','refund_pending','refunded')),
  idempotency_key text not null unique,          -- 'entry-<entryId>'
  refund_id text,
  state_at_capture text,                         -- tournament state when captured
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  round int not null,                            -- 1,2,3
  position int not null,                         -- index within round
  player_a_id uuid references users(id),
  player_b_id uuid references users(id),
  status text not null default 'waiting'
    check (status in ('waiting','awaiting_results','disputed','confirmed')),
  winner_id uuid references users(id),
  next_match_id uuid references matches(id),
  next_slot text check (next_slot in ('a','b')),
  awaiting_since timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_id, round, position)
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  player_id uuid not null references users(id),
  screenshot_path text not null,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','ok','malformed','unreadable')),
  extracted_json jsonb,
  confidence real,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  reason text not null,                          -- see 05 §Agreement rule
  summary text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_by uuid references users(id),
  resolution text check (resolution in ('winner_a','winner_b')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index one_open_dispute_per_match on disputes(match_id) where status = 'open';

create table payouts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  recipient_id uuid not null references users(id),
  place int not null,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'drafted'
    check (status in ('drafted','approved','submitted','succeeded','failed','unclaimed')),
  sender_batch_id text not null,                 -- 'payout-<tournamentId>'
  sender_item_id text not null unique,           -- '<tournamentId>-<place>'
  paypal_batch_id text,
  paypal_item_id text,
  approved_by uuid references users(id),
  approved_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (tournament_id, place)
);

create table audit_log (
  id bigserial primary key,
  tournament_id uuid references tournaments(id),
  actor_type text not null check (actor_type in ('agent','user','system','paypal')),
  actor_id uuid,
  action text not null,                          -- e.g. 'bracket.generated'
  payload jsonb not null default '{}',
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index audit_dedupe on audit_log(tournament_id, dedupe_key) where dedupe_key is not null;

create table webhook_events (
  id text primary key,                           -- PayPal event id
  event_type text not null,
  payload jsonb not null,
  verified boolean not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index on entries(tournament_id, status);
create index on matches(tournament_id, status);
create index on audit_log(tournament_id, created_at);
```

Slot reservation rule (enforced in a transaction in T-032): `count(entries where status in ('pending','paid')) < slots`, with the tournament row locked `for update` while counting.

## State machine

Tournament states and the only legal transitions. Everything else throws.

| From | To | Trigger | Guard |
|------|----|---------|-------|
| `draft` | `open` | host confirms config | config valid |
| `draft` | `cancelled` | host cancels | none |
| `open` | `locked` | agent: last slot paid | paid entries = 8 |
| `open` | `cancelled` | host cancels or deadline passes | none |
| `cancelled` | `refunded` | agent: all refunds complete | every captured payment refunded (vacuously true if none) |
| `locked` | `in_progress` | agent generates bracket | 7 matches created |
| `in_progress` | `results_pending` | final match gets both players | round-3 match `awaiting_results` |
| `results_pending` | `confirmed` | final match confirmed | champion set, payouts drafted |
| `confirmed` | `paid` | all payout items succeeded | no failed or unclaimed items |

Notes: a disputed match does not change the tournament state. Tournament `locked_at` is set on entering `locked`. `payout_split` (and entry fee) can be edited only in `draft`. It is frozen the moment the host confirms (`draft` to `open`), because players pay on the strength of those terms. This is stricter than the PRD, which froze it at lock.

Match states: `waiting` (a slot is empty) to `awaiting_results` (both players known) to `confirmed`; `awaiting_results` to `disputed` to `confirmed` (after host resolution). A match never returns to `waiting`.

Every transition: call `assertTransition(from, to)`, update inside a transaction, write an audit row.

## API routes

All JSON. All mutating routes pass the Origin check and zod validation. `401` unauthenticated, `403` wrong role or not the owner.

| Route | Method | Who | Purpose |
|-------|--------|-----|---------|
| `/api/auth/register` `login` `logout` `me` `demo` | POST/GET | public | see `03` |
| `/api/tournaments` | GET | any | list open tournaments |
| `/api/tournaments` | POST | host | create (state `draft`) from config |
| `/api/tournaments/parse` | POST | host | plain-language to config preview; saves nothing |
| `/api/tournaments/:id` | GET | any | public view: state, pool, bracket, players |
| `/api/tournaments/:id/open` | POST | host owner | `draft` to `open` |
| `/api/tournaments/:id/cancel` | POST | host owner | cancel and refund |
| `/api/tournaments/:id/join` | POST | player | reserve slot, create order, return `approveUrl` |
| `/api/tournaments/:id/activity` | GET | any | audit feed |
| `/api/tournaments/:id/payout` | GET | host owner | draft payout view |
| `/api/tournaments/:id/payout/confirm` | POST | host owner | approve and send, idempotent |
| `/api/matches/:id/submissions` | POST | match players | upload screenshot |
| `/api/disputes/:id/resolve` | POST | host owner | pick winner |
| `/api/paypal/return` `cancel` | GET | player (browser) | checkout return |
| `/api/paypal/webhook` | POST | PayPal | verified events |
| `/api/agent/sweep` | POST | secret header | tick all active tournaments |
| `/api/agent/tick/:id` | POST | secret header | tick one |
| `/api/demo/fill` `submit` | POST | demo only | bots and test screenshots |

## Money rules

1. Cents everywhere internally. Convert to PayPal decimal strings only in `paypal/*` via `toPayPalAmount(cents)`.
2. Prize pool = sum of `payments.amount_cents` where `status = 'captured'`. Read it from the DB.
3. `computePayouts(pool, split)`: for each place except the last, `floor(pool * bps / 10000)`; the last place gets `pool - sum(others)`. Example: $40 pool, 7000/3000 gives $28.00 and $12.00.
4. A payment records `state_at_capture` so audit can show which tournament state it arrived in.

## Idempotency keys

| Operation | Key |
|-----------|-----|
| Create order | `PayPal-Request-Id: entry-<entryId>` |
| Capture order | `PayPal-Request-Id: capture-<entryId>` |
| Refund | `PayPal-Request-Id: refund-<paymentId>` |
| Payout batch | `sender_batch_id: payout-<tournamentId>`, items `<tournamentId>-<place>` |
| Webhook | `webhook_events.id` primary key |
| Audit | `(tournament_id, dedupe_key)` unique index |

## Concurrency and restart safety

- Tournament mutations run in a transaction. The agent tick starts with `pg_advisory_xact_lock(hashtext(tournament_id::text))`, so two ticks never overlap on one tournament.
- Every agent action re-reads state inside the lock and skips if already done (use `dedupe_key`s such as `advance:<matchId>`).
- Nothing important lives in memory. After a crash, the next tick reconstructs what to do from the database.

## Error handling

`AppError(code, message, status)`. Codes used: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `INVALID_TRANSITION`, `TOURNAMENT_FULL`, `PAYMENT_FAILED`, `PAYPAL_ERROR`, `ALREADY_DONE`, `UPLOAD_REJECTED`. PayPal errors log the `PayPal-Debug-Id` header. Never log tokens, secrets, passwords, or full payer details.

## Logging and observability

Structured console JSON logs (`level`, `msg`, `tournamentId`, `requestId`). The audit log is the product-facing trail; console logs are for developers.

## Deployment (Render)

One web service (Node, `npm run build` then `npm start`), health check `/api/health`, env vars set in the dashboard, one cron job calling `POST /api/agent/sweep` every minute with `x-sweep-secret`. Register the PayPal sandbox webhook at `<APP_URL>/api/paypal/webhook` and put its id in `PAYPAL_WEBHOOK_ID`. Local webhook testing needs a public tunnel; otherwise rely on the capture response plus polling, and test webhooks on the deployed preview.

## Security checklist

Hashed passwords (bcrypt) · httpOnly, secure, sameSite=lax session cookie · Origin check on mutating routes · zod on all inputs · webhook signature verification · uploads limited by size and type, stored privately with signed URLs · host-ownership checks on every host route · screenshots treated as untrusted data · no secrets in repo.

## Completion implementation notes

- `POST /api/tournaments/preview`: host-only, same-origin, validates the shared config and returns projected pool/payouts without persistence. The UI does not import server payout math.
- `POST /api/tournaments/:id/payout/retry`: owning host only; body `{ payoutId }`. Retry numbers come from stored rows, never the browser. Repeated confirmation resumes the approved retry batch.
- `GET /api/submissions/:id/image`: authenticated match participant or owning host; redirects to a 60-second private signed URL, no-store. Missing storage is an error, never a synthesized replacement image.
- Tournament GET accepts the session identity for field-level redaction. Public reads omit PayPal emails, storage paths, extraction content for unrelated viewers, raw audit payloads and private dispute summaries. Drafts are host-only.
- Migration `0001_server_only_rls` enables RLS without browser policies on all app tables. Server uses a privileged connection; custom sessions are not Supabase Auth identities.
- `DEMO_PAYPAL_RECIPIENTS`: optional generally, required for demo bot filling/seeding; comma-separated eight sandbox personal recipient emails in player order. `DEMO_BUYER_EMAIL` / `DEMO_BUYER_PASSWORD`: optional sandbox credentials intentionally displayed only in demo mode.
- `SANDBOX_APPROVED_ORDER_ID` / `SANDBOX_PAYOUT_RECIPIENT`: integration-test prerequisites; no production accounts.
- `UMPRA_E2E=1` is internal automated-test configuration, refused outside development with exact local test credentials and in-memory DB. Never set it on Render.
