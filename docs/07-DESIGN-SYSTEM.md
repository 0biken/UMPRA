# 07 — Design system

## Direction

Umpra is a referee. The look comes from the pitch and the match official's kit, not from generic SaaS or gaming chrome: chalk-white paper, deep pitch-green ink, and the three cards an official carries (yellow, red) as the semantic colours for "pay attention" and "dispute". It should read premium, calm, and trustworthy, because the product holds money. Not playful, not neon, not street.

- **Subject:** a tournament umpire that holds a prize pool and pays winners.
- **Audience:** grassroots hosts and players on phones, plus judges on desktop.
- **Primary job:** make the money and the agent's decisions legible and trustworthy.
- **The one memorable thing:** the bracket drawn as chalk lines on a pitch, where a confirmed winner's line draws into the next round. Everything else stays quiet.

Checked against common generated-design defaults: not cream plus terracotta, not near-black plus acid accent, not broadsheet hairlines, not identical rounded cards, no all-caps eyebrow labels, no middle-dot meta strings, no arrow suffixes on buttons. If you add UI, re-check against this list.

## Tokens

Implement exactly as below in `src/app/globals.css` (Tailwind v4 `@theme`), and mirror in `/styleguide`.

```css
@import "tailwindcss";

@theme {
  /* colour: base */
  --color-chalk: #F2F5F1;        /* page background */
  --color-paper: #FFFFFF;        /* panels, inputs */
  --color-ink: #0F231E;          /* text, headings, "paid" fill */
  --color-ink-2: #2B433B;        /* secondary strong text */
  --color-muted: #5B6F67;        /* secondary text (4.8:1 on chalk) */
  --color-line: #D9E1DB;         /* borders, dividers, bracket lines */
  --color-line-strong: #B7C4BB;

  /* colour: brand and status (the pitch and the cards) */
  --color-pitch: #17734A;        /* primary action, confirmed, winner path */
  --color-pitch-dark: #0F5636;   /* hover, pressed */
  --color-pitch-tint: #E1F0E7;
  --color-card-yellow: #F0BE1F;  /* prize pool accent, pending attention */
  --color-yellow-tint: #FCF3CF;
  --color-yellow-ink: #6B4E00;   /* text on yellow tint (7:1) */
  --color-card-red: #CC3B33;     /* disputes, destructive */
  --color-red-tint: #FBE5E3;
  --color-red-ink: #8E2620;      /* text on red tint */

  /* type */
  --font-display: var(--font-bricolage), "Segoe UI", system-ui, sans-serif;
  --font-sans: var(--font-public-sans), "Segoe UI", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  /* radius (graded, not one value for everything) */
  --radius-field: 4px;           /* inputs, chips, table cells */
  --radius-control: 8px;         /* buttons, pills' containers */
  --radius-panel: 14px;          /* panels, dialogs */
  /* pills and avatars: 9999px */

  /* elevation: borders first; one shadow for floating layers only */
  --shadow-float: 0 8px 28px rgba(15, 35, 30, 0.16);

  /* motion */
  --ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-draw: 450ms;
}

html { background: var(--color-chalk); color: var(--color-ink); font-family: var(--font-sans); }
:focus-visible { outline: 3px solid var(--color-pitch); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
```

Fonts (load with `next/font/google` in the root layout, variable fonts, `display: swap`):

```ts
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage' });
const publicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans' });
```

If Bricolage Grotesque fails to load, the fallback stack keeps the layout intact.

### Colour usage

| Use | Token |
|-----|-------|
| Page | chalk |
| Panel, input | paper with 1px `line` border |
| Body text | ink; secondary text muted |
| Primary button | pitch fill, white text; hover pitch-dark |
| Confirmed, winner path, success | pitch |
| Prize pool plate accent, pending or ready-to-act | card-yellow with yellow-tint backgrounds and yellow-ink text |
| Dispute, destructive, error | card-red with red-tint backgrounds and red-ink text |
| Paid out | ink fill pill |
| Cancelled, refunded, disabled | muted on line |

Never put muted text on tinted backgrounds; use the matching `-ink` token. Do not introduce new hues. Single light theme only.

### Type scale

| Token | Size / line height | Font | Weight | Use |
|-------|--------------------|------|--------|-----|
| display | 44 / 48 (mobile 34 / 38) | display | 700 | landing headline, prize figure |
| h1 | 30 / 36 | display | 650 | page titles |
| h2 | 22 / 28 | display | 600 | section titles |
| h3 | 18 / 24 | sans | 650 | panel titles |
| body | 16 / 24 | sans | 400 | default; max line length 65ch |
| small | 14 / 20 | sans | 400 | secondary text, table cells |
| caption | 12.5 / 16 | sans | 500 | timestamps, helper text |

Numerals in tables, ledger, and amounts use `font-variant-numeric: tabular-nums`. Mono is only for ids (PayPal batch id, order id) in the receipt and audit detail. Sentence case everywhere; no all-caps labels, no letter-spaced eyebrows.

### Spacing and layout

4px base unit (Tailwind default). Page padding 16px mobile, 24px tablet, 32px desktop; content max width 1120px; reading width 65ch. Panel padding 16px mobile, 24px desktop. Stack gap between panels 16px. Breakpoints: 640, 768, 1024.

## Components

Build on shadcn/ui primitives (Radix), restyled with the tokens. Show every state in `/styleguide`.

| Component | Spec |
|-----------|------|
| Button | Heights 44 (default), 36 (compact; an invisible 4px extension above and below keeps the tap target at 44). Variants: primary (pitch), secondary (paper, line-strong border, ink text), danger (card-red, white text), ghost. Radius control. A link that looks like a button uses `<Button asChild><Link>`, never a button inside a link. Disabled at 50% opacity with `aria-disabled`. Loading shows an inline spinner and keeps width |
| Input, Select, Textarea | Height 44, paper, 1px muted border (line-strong is 1.8:1 on paper, under the 3:1 a field boundary needs), radius field, visible label above, helper text below, error state with red border, red-ink message and icon |
| StatePill | Pill radius, 28px tall, icon plus label, colours from the state table in `06` |
| Panel | Paper, 1px line border, radius panel, no shadow |
| PrizePlate | The key number. Ink background, chalk text, display type for the amount, a yellow top rule (3px) and the caption "Held by Umpra until the host confirms the payout." Beneath: 8 slot markers (filled pitch for paid, pitch outline for simulated demo players, chalk outline for open slots) and "$X of $40 collected". Explain that demo players add no money. |
| BracketView | SVG. Match cards 160 x 64, radius field, paper with line border; connector lines 2px `line-strong`; confirmed winner's path 2px `pitch`. Draws left to right in rounds. Mobile: round selector plus scrollable full view |
| MatchCard | Two rows (player, score). Winner row bold with pitch left rule; loser muted. Status chip under the card for non-final states |
| ScreenshotUploader | Drop zone with camera and file choices on mobile, preview, replace, size and type hint, client-side resize |
| ScreenshotCompare | Two images side by side (stacked on mobile), each with the extracted name, score, and confidence beneath |
| ActivityLog | The officials' report: a vertical list; each row has time (caption), a glyph (Flag icon for agent, person icon for users), and the sentence from `05`. Agent rows use ink text; the row for a dispute uses red-tint background |
| LedgerTable | Tabular numerals, right-aligned amounts, status pills, totals row, stacked rows on mobile with amounts visible |
| Dialog | Panel radius, `shadow-float`, focus trapped; the payout dialog has the irreversible sentence in h3 and two buttons, "Go back" secondary first, "Send payout" primary |
| Toast | Bottom on mobile, top-right on desktop; same verb as the button that caused it |
| Banner | Full-width within content, tinted background plus icon plus text plus optional action; variants info (pitch), attention (yellow), problem (red) |
| EmptyState | One sentence and the one action that fills it |
| Skeleton | Line-coloured blocks matching the final layout |
| Stepper | The lifecycle (Describe, Pay, Play, Umpire, Pay out). Numbering is allowed here because it is a true sequence |

Icons: `lucide-react`, 20px, 1.75 stroke. Referee flag icon (`Flag`) is the agent's glyph.

## Motion

Motion answers an action or marks a state change, nothing decorative.

1. **Winner line draw** (the signature): when a match becomes confirmed, the winner's connector animates `stroke-dashoffset` over `--dur-draw` with `--ease-out`, then the next match card's slot fills.
2. **Landing**: the mini bracket draws itself once on load.
3. Dialogs fade and rise 8px over `--dur-base`. Buttons change colour over `--dur-fast`.
4. No scroll-triggered fades, no hover lifts on cards.
5. With `prefers-reduced-motion`, all of the above appear instantly.

## Voice

See `06 §Copy rules`. The interface speaks like an official: brief, factual, neutral. It states results ("Both screenshots agree. Kemi won 3-1.") and does not editorialize.

## Do not

Add colours outside the tokens · use gradients, glow, or glassmorphism · use one radius for everything · add card shadows · use all-caps or letter-spaced labels · accent a single word in a headline · use emoji in the UI · use third-party game logos or names · rely on colour alone to convey state.
