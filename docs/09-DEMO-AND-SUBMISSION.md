# 09 — Demo, README, and submission

## Sandbox accounts to record (fill in; never commit passwords)

| Role | Email | Notes |
|------|-------|-------|
| Platform business account | _(fill)_ | receives fees, sends payouts; confirm Payouts enabled and balance |
| Judge test buyer (personal) | _(fill)_ | shown on landing page when `DEMO_MODE=true`; password in the hosted env or Devpost "testing instructions", not the repo |
| Demo players 1 to 8 (personal) | _(fill)_ | payout recipients; mapped to `demo-player-N@umpra.test` |

Demo bots are marked `simulated` on their entries: they take slots without a real PayPal capture so a solo judge can complete a tournament. State this plainly in the UI ("simulated demo players") and in the README. Real money-in capture is shown with the judge's own sandbox buyer for at least one entry.

## Demo mode behavior (`DEMO_MODE=true` only)

- Landing shows "Try as host", "Try as player", and the test buyer credentials.
- Host tournament page shows a "Demo controls" panel: **Fill with demo players** (adds simulated players to remaining slots) and **Submit demo results** per match with a choice of scenario: *agree* (matching screenshots), *mismatch* (conflicting screenshots), *unreadable* (blurry image).
- Demo screenshots come from `scripts/make-screenshots.ts`: generic scoreboard images drawn by us (no third-party logos, names, or music), covering matching, mismatching, blurry, and wrong-names cases.
- With `DEMO_MODE=false` none of this exists (routes 404).

## Seed script (`npm run db:seed`)

Creates the demo host, eight demo players, and optionally one tournament in each of: open (empty), open (6 of 8 paid), in progress (round 2 with a dispute), confirmed (payout ready). Idempotent: re-running does not duplicate.

## Demo video script (under 3 minutes)

Record on the device it was built for, public on YouTube, no copyrighted music, no third-party trademarks (no FIFA or other game logos; use the generic scoreboard).

| Time | Beat | Show |
|------|------|------|
| 0:00 to 0:20 | The problem | Real organizer quote(s) on screen; grassroots tournaments run on transfers, screenshots, trust |
| 0:20 to 0:40 | Describe | Host types the tournament in plain words; parsed preview; open registration |
| 0:40 to 1:05 | Pay | A player pays with PayPal sandbox; prize pool updates live; slot markers fill (cut to full) |
| 1:05 to 1:25 | The agent draws the bracket | Activity feed sentences appear; bracket draws |
| 1:25 to 2:00 | Umpire | One match: two agreeing screenshots auto-confirm and the winner line draws; one match: mismatch, flagged with the summary, host resolves |
| 2:00 to 2:30 | Release | Final confirmed; payout review; "cannot be recalled" dialog; one tap; PayPal Payouts result; balanced ledger |
| 2:30 to 2:50 | Why it is safe | Say the guardrails in one breath: deterministic amounts, one human checkpoint, idempotent money, full audit log |
| 2:50 to 3:00 | Close | Name, link, what is next |

Rehearse twice with the exact seeded data. Keep a recorded fallback clip of the PayPal approval step in case the sandbox is slow.

## README outline

1. What Umpra is (two sentences) and a screenshot or GIF
2. Live demo link and how to try it in two minutes (demo buttons, test buyer)
3. How it works: the lifecycle and the autonomous umpire, with the loop diagram
4. Where PayPal is used: Orders (entry fees), Payouts (winners), Webhooks, and the Agent Toolkit or MCP decision from `04`
5. Where AI is used: vision for screenshots, dispute summaries, plain-language setup, with the model name and what the model is **not** allowed to do
6. Safety design: host checkpoint, deterministic payout math, idempotency, audit log, low-confidence escalation
7. Architecture notes: stack, folder map, state machine, data model (link to `docs/02-TECHNICAL.md`)
8. Run locally: prerequisites, env vars (`.env.example`), migrate, seed, dev, tests, sandbox setup, webhook tunnel note
9. Tests: how to run each layer and what the edge-case matrix covers
10. Known limitations: sandbox only, one game, 8 players, single elimination, no password reset or email verification, in-memory rate limit, simulated demo players, not a licensed escrow or money-transmission service
11. AI tools used (models, coding assistants, services) and how
12. Licence (MIT)

## Devpost text outline

Inspiration (the Nigerian grassroots problem and the real quotes) · What it does · How we built it (stack, PayPal tools, vision model) · Safety and guardrails · Challenges (idempotency, evidence reliability) · What we learned · What is next (more formats and games, real payments through a licensed partner) · Built with · Testing instructions (demo buttons, test buyer, sandbox note).

## Submission checklist

- [ ] Working project using PayPal (sandbox) and AI meaningfully
- [ ] Text description of features and functionality
- [ ] Functional demo: hosted URL (plus run instructions in the repo)
- [ ] Tools list: AI models and services used, and how
- [ ] Public repo with all source, assets, instructions, and a visible `LICENSE` (MIT)
- [ ] Demo video under 3 minutes, public on YouTube, shown on the device it was built for, no copyrighted music or third-party trademarks
- [ ] No API keys or secrets in the repo or its history
- [ ] Official Rules re-read for country or prize restrictions (open question from the PRD)
- [ ] Submitted a day before the deadline (target Nov 11; hard deadline Nov 12, 12:00pm PST, 9:00pm Lagos)

## Awards to target deliberately

Best Use of PayPal + AI, Best Use of Agentic Commerce, Most Impactful, Best Demo Delivery. Render only if the Render deployment is genuinely used (it is). Keep the pitch centred on the evidence-based autonomous umpire, since "pay on approval" alone is not novel.

## Open items for the human

Name check for "Umpra" (domain, GitHub, trademark) · real organizer quotes (T-114) · create the sandbox accounts above · confirm Payouts works in the sandbox (T-031) · read the Official Rules for payout restrictions · decide the Agent Toolkit question at T-070.
