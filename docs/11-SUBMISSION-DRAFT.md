# 11 — Submission draft and video handoff

Draft only. Add live URLs, actual integration evidence, and real quotes after verification. Do not present test-provider output as live PayPal or AI behavior.

## Inspiration

Grassroots tournaments often leave one organizer coordinating entry fees, brackets, screenshots, disputed results, and prize payments. We wanted an umpire that could do the routine work and show why it made each decision.

Organizer interviews are still pending. Add 2–3 approved, attributed quotes after collecting them; no fabricated testimonials are included here.

## What it does

Umpra runs an eight-player single-elimination tournament. Players pay through PayPal sandbox checkout and upload result screenshots. Claude reads each image; deterministic rules confirm agreeing evidence or send unclear results to the host. Winners advance automatically. After the final, code computes the payout and the host reviews and confirms the PayPal batch. Every action is visible in an audit feed.

## How we built it

Next.js, TypeScript, Tailwind and themed Radix primitives provide a mobile-first interface. Supabase hosts Postgres and private screenshots; Drizzle handles database access. PayPal Orders, capture, refunds, Payouts, signature verification, and status polling sit behind a typed service and audited agent tools. Anthropic Claude handles screenshot extraction, dispute summaries and plain-language setup. The model cannot select payment amounts or release money.

We evaluated the PayPal Agent Toolkit and kept direct REST to preserve our explicit request IDs, approval boundary and narrow typed service. See the source-linked decision in `04-PAYPAL.md`.

## Challenges and learning

The difficult boundary is turning unreliable evidence and retried network requests into one auditable outcome. The agent resumes from database state, money operations reuse stable IDs, and low confidence goes to a human. Demo bots fill seats without inventing captured fees; payout amounts always follow actual verified captures.

## Safety and limitations

Sandbox USD only, eight players, single elimination, generic scoreboard imagery. Simulated participants are labeled and add no funds. The release still needs account-specific verification and hosted acceptance before we claim a working public demo. This is a hackathon prototype, not a production financial service.

## What is next

Validate the prototype with tournament organizers, improve evidence handling from real play, and investigate production payments through an appropriate licensed partner before expanding formats or games.

## Testing instructions for judges (publish after deployment)

Use the hosted link and its host/player demo buttons in separate browser profiles. Complete one sandbox checkout using the provided sandbox personal buyer, then fill remaining seats with simulated players. Submit matching results and one mismatch, resolve the mismatch as host, finish the final, review the actual captured pool, confirm payout, and inspect the receipt/ledger. With one $5 entry and seven bots, payouts are $3.50 and $1.50 at 70/30.

Before submission, replace these instructions with the verified URL and the tested account guidance. Keep service/API secrets out of Devpost.

## Video shot list (2:50 target)

| Time | Screen and narration |
| --- | --- |
| 0:00–0:20 | Problem and one real approved organizer quote; if quotes are not obtained, describe the workflow without attributing a quote. |
| 0:20–0:40 | Describe an eight-player $5, 70/30 tournament, edit/review terms, open registration. |
| 0:40–1:05 | Player sandbox approval and verified pool update; label the seven demo seats as simulated with no fee. |
| 1:05–1:20 | Bracket generation and visible agent audit actions. |
| 1:20–1:55 | Two matching screenshots, automatic advancement, then mismatch summary, original images and host ruling. |
| 1:55–2:25 | Final, actual $5 review, explicit payout confirmation, settled recipient results and balanced ledger. |
| 2:25–2:45 | Explain deterministic amounts, human approval, stable IDs, restart safety and the audit trail. |
| 2:45–2:50 | Umpra name and actual demo/repo links. |

Record real hosted interactions after verification, rehearse twice, keep a sandbox approval fallback clip, and use only assets/audio you can publish. Human records/uploads the video and submits Devpost.
