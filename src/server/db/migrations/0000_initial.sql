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
--> statement-breakpoint
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users(id),
  title text not null,
  game text not null,
  format text not null default 'single_elimination',
  slots int not null default 8 check (slots = 8),
  entry_fee_cents int not null check (entry_fee_cents between 100 and 2000),
  currency text not null default 'USD' check (currency = 'USD'),
  payout_split jsonb not null,
  state text not null default 'draft',
  bracket_seed int,
  registration_closes_at timestamptz,
  champion_id uuid references users(id),
  cancel_reason text,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create table entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  player_id uuid not null references users(id),
  gamertag text not null,
  status text not null default 'pending'
    check (status in ('pending','paid','cancelled','expired','refunded')),
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id),
  unique (tournament_id, gamertag)
);
--> statement-breakpoint
create table payments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  entry_id uuid not null unique references entries(id),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  amount_cents int not null,
  status text not null default 'created'
    check (status in ('created','approved','captured','failed','refund_pending','refunded')),
  idempotency_key text not null unique,
  refund_id text,
  state_at_capture text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create table matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  round int not null,
  position int not null,
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
--> statement-breakpoint
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
--> statement-breakpoint
create table disputes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  reason text not null,
  summary text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_by uuid references users(id),
  resolution text check (resolution in ('winner_a','winner_b')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
--> statement-breakpoint
create unique index one_open_dispute_per_match on disputes(match_id) where status = 'open';
--> statement-breakpoint
create table payouts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  recipient_id uuid not null references users(id),
  place int not null,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'drafted'
    check (status in ('drafted','approved','submitted','succeeded','failed','unclaimed')),
  sender_batch_id text not null,
  sender_item_id text not null unique,
  paypal_batch_id text,
  paypal_item_id text,
  approved_by uuid references users(id),
  approved_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (tournament_id, place)
);
--> statement-breakpoint
create table audit_log (
  id bigserial primary key,
  tournament_id uuid references tournaments(id),
  actor_type text not null check (actor_type in ('agent','user','system','paypal')),
  actor_id uuid,
  action text not null,
  payload jsonb not null default '{}',
  dedupe_key text,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index audit_dedupe on audit_log(tournament_id, dedupe_key) where dedupe_key is not null;
--> statement-breakpoint
create table webhook_events (
  id text primary key,
  event_type text not null,
  payload jsonb not null,
  verified boolean not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index on entries(tournament_id, status);
--> statement-breakpoint
create index on matches(tournament_id, status);
--> statement-breakpoint
create index on audit_log(tournament_id, created_at);
