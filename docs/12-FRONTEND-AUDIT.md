# 12 - Frontend audit (Phase 0)

Audit of the M8 screens as they stood after commit `f747762`, walked at 360px in the browser against a local demo server. Findings are grouped by the tasklist item that should fix them. Phases 1 to 5 of the frontend plan work from this list.

How the audit was run: `node scripts/local-check.mjs dev` (in-memory database, fake PayPal, fake vision, port 3317; also registered in `.claude/launch.json`). Flow walked: demo host login, create, open registration, one fake checkout as a demo player, fill demo players, agree result, conflicting result, resolve dispute, play to the final, payout review. Nothing was sent to PayPal.

## Fixed in Phase 0

| Finding | Fix |
|---------|-----|
| Landing page was 510px wide at 360px; headline and body text were cut off. The bracket SVG (`min-w-[460px]`) stretched its grid column | `min-w-0` on the hero grid children. The bracket now scrolls inside its own container |
| 11 em-dashes in visible strings (page title, score and id placeholders, styleguide options) | Replaced with a hyphen or a colon |
| Signed-in header was 201px tall at 360px, flashed signed-out links on load, and showed "Open tournaments" to hosts and signed-out visitors (a dead end: `/play` is player-only) | Phase 1: one 56px row plus a 46px scrolling nav strip below `md`, nav inline from `md`. The session comes from the server layout, so the right links render on first paint. Nav is role-aware: hosts get My tournaments and New tournament, players get Open tournaments, signed-out visitors get none |
| `<a><button>` nesting on every link-styled button (double tab stop, invalid HTML) | Phase 1: `Button` has `asChild`; every Link-wrapped button now uses it |
| Header buttons and logo under 44px | Phase 1: 44px |
| Landing hero: 3-line headline, caption under the CTAs, boxed lifecycle cards | Phase 1: 2-line headline ("Umpire the bracket. Pay the winners."), 18-word subtext, caption moved into the sandbox panel, lifecycle is an open row of five steps. The mini bracket no longer scrolls at 1280px |
| Host dashboard link "Open tournament" only viewed the page | Phase 1: renamed "View" |
| Tournament page: demo controls above the bracket, plate showing 8 filled markers next to "$5 of $40", wrong-tense "Terms locked" text, middle-dot meta line, wrapping tab row, "Semi-finals" versus "Semifinals" | Phase 2: demo controls follow the tabs once play starts (above them while the field is filling); plate markers are paid (filled), simulated (ring) and open (faint ring) with a caption and screen-reader label; meta line has no dots; tabs are one scrollable 44px row with roving tabindex and arrow, Home and End keys; round names match the server ("Quarterfinals", "Semifinals"); the stray leading space in `getRoundName(3)` is gone |
| Players tab said "8 of 8 paid" and "Paid $5.00" for demo players | Phase 2: heading counts filled slots and real payments separately; demo players show "No payment (demo)" |
| Ledger: Amount column off screen at 360px, raw status words ("captured"), "-$0.00" | Phase 2: stacked rows with the amount visible below `sm`, table from `sm`; plain status labels; "$0.00"; totals as a list |
| Activity: icons were the only sign of who acted | Phase 2: screen-reader prefix ("Umpra:" or "Person:") on each entry |
| Winner-line draw animation not verified | Phase 2: observed firing on a live confirmation (`umpra-bracket-draw`, 0.45s, dash length matches the path). Reduced motion not toggled live; the global CSS rule disables the animation |

## Open findings

### T-080 App shell

- Remaining: compact buttons (36px) and the tournament tabs (36px) are still under 44px. Cleared in T-092.

### T-081 Landing

- Done in Phase 1 (see the fixed list). Remaining: when a user is already signed in, the landing page still offers the "Try as host / player" buttons.

### T-082 Host dashboard

- The meta line uses middle dots ("Table Football · $5.00 entry · 0 of 8 players paid"); `07` says no middle-dot strings.
- The empty dashboard shows two "New tournament" buttons (page header and empty state). Keep only the empty-state action.

### T-084, T-085, T-090, T-091 Tournament page, bracket, Activity, Ledger

- Done in Phase 2 (see the fixed list). Remaining: the mobile round selector wraps to two rows at 360px; tabs are not yet checked for the "Final being checked" and cancelled or refunded states; Activity shows times without dates.

### T-088 Dispute view

- Works: reason, summary, both screenshots with alt text, extracted data, two 44px decision buttons.
- After resolving, the page still shows the "Needs host" pill and no confirmation text. `06` promises "Resolved. Umpra has moved <winner> to the next round."
- The screenshot area is a blank chalk box until the lazy image loads. Use the `Skeleton` component.
- The demo submit buttons expose no accessible name in the accessibility tree.

### T-089 Payout review and confirm

- At 360px the table scrolls sideways and the Amount column, the most important figure, is off screen. Use stacked recipient cards on mobile.
- "1 disputes resolved by you": plural bug. The match and dispute counts also appear twice on the page.
- The raw status "drafted" is shown to users. Use plain words ("Ready to send").
- "Confirm payout" is well below the fold at 360px.
- The confirm dialog, progress and receipt states were not exercised.

### Server

- A malformed id in a path (`/api/tournaments/undefined/open`) returns `500 INTERNAL_ERROR`. It should be a 400 or 404 with a plain message. Not a frontend bug; found while auditing.

### Tests (environment)

- `npm test` crashes workers at start on this machine (about 0.3 GB of 7.7 GB free): the in-memory Postgres (pglite) runs out of memory when a worker starts (exit codes 134, 2147483651, 3221226505). Each of the 12 test files passes when run on its own (60 tests). Close other applications, or run files one at a time, before trusting a full-run failure here.

## Not yet audited

- `/host/new` (describe and form paths, parsed preview, review card)
- 768px and 1280px widths on every page except the landing and tournament pages
- Player match panel and screenshot upload (T-087)
- Payout dialog, result and receipt states
- Keyboard order and focus return in dialogs
- `/styleguide` against the current components

## Left as is

- `ui/prize-plate.tsx`, `ui/state-pill.tsx` and `ui/textarea.tsx` are thin re-exports of the `tournament/` and `input` components. They are harmless; revisit only if they cause confusion.
