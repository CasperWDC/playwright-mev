# playwright-mev

Playwright suite that checks live MEV case-study pages against their Figma designs — text content, font family/weight/size, color, underline/strikethrough, line-wrap, spacing, and borders — across desktop/tablet/mobile breakpoints. Also runs a full-page pixel diff against exported design PNGs.

## Setup

```
npm install
npx playwright install --with-deps
```

No secrets or `.env` needed to run the suite — the staging login is a hardcoded gate password (see `playwright/page-ready.ts`), not a real credential.

## Running

```
npx playwright test                          # everything, all breakpoints
npx playwright test tests/design-tokens.spec.ts   # design-vs-DOM diff only
npx playwright test tests/pixel-diff.spec.ts       # pixel diff only
npx playwright test --grep cartier            # one page only
npx playwright test --ui                      # interactive runner
```

Results:
- Console output — a findings table per severity (P0-P3, see below).
- `test-results/design-review-<page>-<breakpoint>.json` — full findings dump.
- `test-results/<page>-diff-<breakpoint>.png` — visual diff for the pixel-diff test.

## Adding a new page

1. Add an entry to `playwright/pages.ts`:
   ```ts
   { slug: 'my-page', url: 'https://mev-stage.webflow.io/private-pages/my-page' }
   ```
2. In Figma, select the desktop/tablet/mobile frame for that page and run the **Design QA token export** plugin (`figma/plugin/` — import once via *Plugins → Development → Import plugin from manifest*, pointing at `figma/plugin/manifest.json`). Download the JSON for each breakpoint and save as:
   ```
   design/my-page/tokens-desktop.json
   design/my-page/tokens-tablet.json
   design/my-page/tokens-mobile.json
   ```
3. (Optional, for the pixel-diff test) Export a PNG of each frame and save as:
   ```
   design/my-page/my-page-design.png            # desktop
   design/my-page/my-page-design-tablet.png
   design/my-page/my-page-design-mobile.png
   ```

That's it — both spec files loop over `playwright/pages.ts` automatically. A page missing its tokens/PNG is skipped, not failed.

## Severity levels

- **P0** — blocking: e.g. wrong font family.
- **P1** — blocking: e.g. wrong font size/color, missing content, a mixed Cyrillic/Latin homoglyph typo on the live page.
- **P2** — visible but non-blocking: e.g. spacing/border drift, extra content not in the design.
- **P3** — informational only: low-confidence findings (ambiguous text match, unverifiable due to a design-canvas/viewport width mismatch, tiny infographic-label text).

P0/P1 fail the test run; P2/P3 are reported but don't block.

## Notes

- The `tablet` breakpoint viewport (991px) intentionally does **not** match the Figma tablet frame's own canvas width (677px) — it's set to match the live site's actual CSS tablet tier instead. The diff engine detects this mismatch per page and automatically downgrades position-based findings (spacing) to low-confidence rather than trusting them.
- `figma/sync-tokens.js` (REST API sync) is legacy — Figma's Starter-plan rate limiting makes it unreliable. The Figma plugin (`figma/plugin/`) is the supported way to export tokens.
