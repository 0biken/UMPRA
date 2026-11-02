# 12 - Frontend audit (Phase 0)

Audit of the M8 screens as they stood after commit `f747762`, walked at 360px in the browser against a local demo server. Findings are grouped by the tasklist item that should fix them. Phases 1 to 5 of the frontend plan work from this list.

How the audit was run: `node scripts/local-check.mjs dev` (in-memory database, fake PayPal, fake vision, port 3317; also registered in `.claude/launch.json`). Flow walked: demo host login, create, open registration, one fake checkout as a demo player, fill demo players, agree result, conflicting result, resolve dispute, play to the final, payout review. Nothing was sent to PayPal.

## Fixed in Phase 0

| Finding | Fix |
|---------|-----|
| Landing page was 510px wide at 360px; headline and body text were cut off. The bracket SVG (`min-w-[460px]`) stretched its grid column | `min-w-0` on the hero grid children. The bracket now scrolls inside its own container |
| 11 em-dashes in visible strings (page title, score and id placeholders, styleguide options) | Replaced with a hyphen or a colon |

## Open findings

### T-080 App shell

- The signed-in header is 201px tall at 360px because the nav wraps onto three rows. That is a quarter of the screen on every page.
- The header shows the signed-out links (Sign in, Register) for a moment before the session resolves, then swaps. Render a neutral header until the session is known.
- Tap targets under 44px: nav links and Sign in / Register buttons (36px), the Umpra logo link (24px), compact buttons, tournament tabs (36px).
- Links wrap buttons (`<a><button>`): the header, the host dashboard ("New tournament", "Open tournament") and the payout page ("Back to tournament"). It is invalid HTML and gives two tab stops per control.
- "Open tournaments" is shown to signed-out visitors and sends them to the login page.

### T-081 Landing

- Fixed overflow only. The hero still needs the design pass (headline is five lines at 360px; body is seven).

### T-082 Host dashboard

- The meta line uses middle dots ("Table Football · $5.00 entry · 0 of 8 players paid"); `07` says no middle-dot strings.
- The "Open tournament" link only views the page. Next to the real "Open registration" action that is confusing. Rename it ("View").

### T-084 Tournament page

- The solo-judge demo controls sit above the bracket and push it below the fold. The bracket should lead; demo controls go below or into a collapsible panel.
- The prize plate shows all 8 slot markers filled when demo players fill the slots, next to "$5 of $40 collected". Decide what the markers mean when bots fill slots (paid versus taken) and make the plate consistent.
- A draft tournament says "Terms locked once registration opens". The doc string is "Terms lock once you open registration."
- Meta line uses middle dots (same as T-082).
- At 360px the tab row wraps and "Ledger" lands on a second row. Make the tabs a single scrollable row or shorten the labels.
- The UI says "Semi-finals" and the activity feed says "Semifinals". Pick one.

### T-085 Bracket

- Works: the round selector, one round at a time, and the full SVG view (the confirmed winner's path draws in pitch green and scrolls inside its own container). Match buttons have excellent labels.
- Not verified: the winner-line draw animation itself, and the reduced-motion fallback.

### T-088 Dispute view

- Works: reason, summary, both screenshots with alt text, extracted data, two 44px decision buttons.
- After resolving, the page still shows the "Needs host" pill and no confirmation text. `06` promises "Resolved. Umpra has moved <winner> to the next round."
- The screenshot area is a blank chalk box until the lazy image loads. Use the `Skeleton` component.
- The demo submit buttons expose no accessible name in the accessibility tree.

### T-089 Payout review and confirm

- At 360px the table scrolls sideways and the Amount column, the most important figure, is off screen. Use stacked recipient cards on mobile.
- "1 disputes resolved by you": plural bug. The match and dispute counts also appear twice on the page.
- The raw status "drafted" is shown to users. Use plain words ("Ready to send").
- Two "Back to tournament" controls.
- "Confirm payout" is well below the fold at 360px.
- The confirm dialog, progress and receipt states were not exercised.

### Server

- A malformed id in a path (`/api/tournaments/undefined/open`) returns `500 INTERNAL_ERROR`. It should be a 400 or 404 with a plain message. Not a frontend bug; found while auditing.

### Tests (environment)

- `npm test` crashes workers at start on this machine (about 0.3 GB of 7.7 GB free): the in-memory Postgres (pglite) runs out of memory when a worker starts (exit codes 134, 2147483651, 3221226505). Each of the 12 test files passes when run on its own (60 tests). Close other applications, or run files one at a time, before trusting a full-run failure here.

## Not yet audited

- `/host/new` (describe and form paths, parsed preview, review card)
- Player match panel and screenshot upload (T-087)
- Activity and Ledger tab visuals
- 768px and 1280px widths
- Payout dialog, result and receipt states
- Keyboard order and focus return in dialogs
- `/styleguide` against the current components

## Left as is

- `ui/prize-plate.tsx`, `ui/state-pill.tsx` and `ui/textarea.tsx` are thin re-exports of the `tournament/` and `input` components. They are harmless; revisit only if they cause confusion.
