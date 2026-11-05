# 03 — Authentication (simple)

Goal: the least auth that is still correct. Email and password, two roles, a signed cookie, and one-click demo accounts so judges need no setup. No OAuth, no email verification, no password reset (out of scope for the hackathon; note it in the README as a known limitation).

## Model

- Roles: `host` and `player`. A user has exactly one role, chosen at registration.
- Session: stateless JWT (HS256, `jose`) in an httpOnly cookie. No sessions table.
- Passwords: `bcryptjs`, cost 10.

## Session cookie

| Property | Value |
|----------|-------|
| Name | `umpra_session` |
| Contents | `{ sub: userId, role, exp }` |
| Lifetime | 7 days, no sliding refresh |
| Flags | `httpOnly`, `secure` in production, `sameSite=lax`, `path=/` |
| Signing | `SESSION_SECRET`, HS256 |

## Routes

| Route | Body | Result |
|-------|------|--------|
| `POST /api/auth/register` | `{ email, password, displayName, role }` | creates user, sets cookie, returns user |
| `POST /api/auth/login` | `{ email, password }` | sets cookie, returns user |
| `POST /api/auth/logout` | none | clears cookie |
| `GET /api/auth/me` | none | current user or `401` |
| `POST /api/auth/demo` | `{ role }` | only if `DEMO_MODE=true`; logs in a seeded demo user of that role; otherwise `404` |

Validation (zod): email valid and lowercased; password 8 to 72 characters (bcrypt limit); displayName 2 to 40; role is `host` or `player`.

Error behavior: login failure always returns `INVALID_CREDENTIALS` with the same message whether the email or password was wrong. Registering an existing email returns a clear `EMAIL_TAKEN` message. Never return `password_hash`.

Rate limit: in-memory counter on login, 10 attempts per 15 minutes per IP and email. Good enough for a prototype; note the limitation in the README.

## Server helpers (`src/server/auth/`)

```ts
// session.ts
signSession(user): Promise<string>
verifySession(token): Promise<{ sub: string; role: Role } | null>
getSession(): Promise<SessionUser | null>      // reads cookie via next/headers

// guards.ts
requireUser(role?: Role): Promise<SessionUser>  // throws AppError UNAUTHENTICATED / FORBIDDEN
requireTournamentHost(tournamentId): Promise<{ user; tournament }>  // owner check
assertSameOrigin(req): void                     // Origin header must match APP_URL host
```

`requireUser` loads the user row on each call, so a deleted user's cookie stops working.

## Route protection

- Middleware: `/host/**` requires role `host`; `/play/**` requires `player`. Unauthenticated users go to `/login?next=...`. Wrong role gets a page that says what the role limit is and offers a switch (log out, register as the other role).
- API routes call `requireUser` themselves. Middleware is for UX; API checks are the real security.
- Public (no auth): landing, login, register, `GET /api/tournaments*` read views, `/t/[id]`, `/api/paypal/webhook` (verified by signature), `/api/agent/*` (verified by secret header).

## Authorization rules

| Action | Allowed |
|--------|---------|
| Create, open, cancel tournament | role `host` |
| Edit, open, cancel, resolve disputes, confirm payout | the tournament's own host only |
| Join tournament | role `player`, once per tournament |
| Upload screenshot | one of the two players of that match only |
| View dispute details and payout draft | the tournament's host |
| View bracket, pool, activity, ledger | anyone (public tournament page) |

## Player payout details

A player must provide a PayPal email when joining (stored on the user; prefilled next time). It must be a PayPal **sandbox personal account** email. The join form says so. The payout goes to this email.

## Demo accounts

Seeded with `is_demo = true`: one host (`demo-host@umpra.test`) and eight players (`demo-player-1@umpra.test` ... `demo-player-8@umpra.test`) with a known demo password held in the seed script and shown only when `DEMO_MODE=true`. Demo users' PayPal emails point at sandbox personal accounts you create; list them in `09`.

## Tasks that implement this

T-010 to T-014. Tests: sign/verify (tampered, expired), login errors are identical for bad email vs bad password, cross-origin POST rejected, wrong-role redirect, `demo` route 404 when `DEMO_MODE=false`.
