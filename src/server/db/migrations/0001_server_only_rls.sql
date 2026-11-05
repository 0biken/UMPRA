-- App sessions are custom JWTs, not Supabase Auth identities. All data access goes
-- through the server's privileged database connection and explicit ownership checks.
-- No browser/Data API role receives row policies.
alter table users enable row level security;
--> statement-breakpoint
alter table tournaments enable row level security;
--> statement-breakpoint
alter table entries enable row level security;
--> statement-breakpoint
alter table payments enable row level security;
--> statement-breakpoint
alter table matches enable row level security;
--> statement-breakpoint
alter table submissions enable row level security;
--> statement-breakpoint
alter table disputes enable row level security;
--> statement-breakpoint
alter table payouts enable row level security;
--> statement-breakpoint
alter table audit_log enable row level security;
--> statement-breakpoint
alter table webhook_events enable row level security;
