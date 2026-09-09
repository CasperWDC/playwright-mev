# frontend-qa — agent instructions

Playwright suite comparing live MEV case-study pages against Figma designs. See `README.md` for setup/run commands and how to add a new page — read that first for the mechanics. This file covers how to operate the suite and report results.

## Running a check

```
npx playwright test --grep <slug>
```

Reads findings from `test-results/design-review-<slug>-<breakpoint>.json` after the run (or the console `console.table` output) rather than re-deriving them by hand.

## Reporting findings — always use this format

Never report findings as a flat prose list. Always a table, split into these buckets, most important first:

**🔴 Критично — блокирует (P0/P1, надёжно)** — table: Что не так | Где на странице | Ожидается | Сейчас | Breakpoint

**🟡 Заметно, не блокирует (P2, надёжно)** — same columns.

**⚪ Низкая уверенность (ambiguous-совпадение или P3)** — table: Что не так | Где на странице | Ожидается | Сейчас | Почему не доверяю

**⚫ Известный шум (не баги)** — short list, no table (see "Known noise" below).

Rules:
- Every row needs a concrete location (section/component description — "хлебная крошка над hero", "форма Get in touch в футере"), not just the flagged text. If unknown, find it: open the page with Playwright, locate the element by its exact text, and describe it via its class-path / nearby landmark before writing the row.
- A finding whose `detail` contains "ambiguous match" always goes in the low-confidence bucket, never the top two — the text-matching engine (`playwright/design-diff.ts`) capped it there itself because the same copy repeats elsewhere on the page and the pairing may be wrong.
- `missing-content` / `extra-content` findings are very often just design-vs-live copy drift in a shared nav/footer component, or a rotating "Related Case Studies" carousel showing a different card than what was in the Figma export at capture time — not a build bug. Recognize the pattern (see "Known noise") before reporting it as a real finding.

## Known site-wide bugs (recognize, don't re-report as new)

Seen identically on multiple pages (`cartier`, `open-study`) — a shared-component/CSS issue, not page-specific:
- **"View All"** button/link: Figma expects white text, live renders `rgb(80,124,123)` (teal) — link color not overridden by the button style.
- **Dark heading text**: Figma expects `rgb(38,38,38)`, live renders `rgb(24,24,27)` — one shared CSS class rendering a shade too dark.

If a new page's report shows either of these exact patterns, call it out as "known site-wide bug, already seen on other pages" alongside the finding — don't present it as a fresh discovery.

## The tablet breakpoint is intentionally not 1:1 with the Figma tablet frame

`playwright.config.ts`'s `tablet` project uses a 991px viewport — the site's real CSS tablet tier is 768-991px (confirmed empirically: font sizes step down exactly at 768px). The Figma "tablet" frames are built at 677px canvas width instead (a source-file quirk, not fixable from this repo). `diffDesignVsDom()` detects this mismatch per page (`positionReliable` in `tests/design-tokens.spec.ts`, comparing `tokens.frame.width` to the live viewport) and automatically downgrades position-based findings (spacing/gap) to low-confidence P3 when they don't line up — trust that downgrade, don't re-verify it by hand unless investigating something specific.

## Mixed-script (Cyrillic homoglyph) check

Only checks the live DOM, not the Figma source — see `checkMixedScript()` in `playwright/design-diff.ts`. A design-side typo in a shared template would otherwise get reported on every page that reuses it, which isn't useful; a live-page typo is a real, page-specific content bug worth flagging.
