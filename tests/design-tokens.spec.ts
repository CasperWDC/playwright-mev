import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { openAndPrepare } from '../playwright/page-ready';
import { loadDesignTokens, extractDomTexts, diffDesignVsDom, checkFontFaces, Finding } from '../playwright/design-diff';
import { PAGES } from '../playwright/pages';

// Design-vs-build check: text, font size, font weight and vertical spacing,
// sourced straight from Figma nodes (see figma/sync-tokens.js or figma/plugin/)
// instead of a flat exported PNG. Runs once per page (playwright/pages.ts) per
// breakpoint project (desktop/tablet/mobile in playwright.config.ts).
//
// This complements, and does not replace, pixel-diff.spec.ts's full-page pixel
// diff — that one catches layout/visual drift this spec can't reason about,
// this one tells you *what* is wrong (wrong weight, wrong size, wrong gap).

for (const { slug, url } of PAGES) {
  test(`${slug} — design tokens QA`, async ({ page }, testInfo) => {
    const breakpoint = testInfo.project.name; // 'desktop' | 'tablet' | 'mobile'

    const tokensPath = path.join('design', slug, `tokens-${breakpoint}.json`);

    test.skip(
      !fs.existsSync(tokensPath),
      `No design tokens yet at ${tokensPath} — run the Figma plugin (figma/plugin/) on the ${breakpoint} frame and drop the downloaded JSON there.`
    );

    const tokens = loadDesignTokens(tokensPath);

    await openAndPrepare(page, url);

    const domTexts = await extractDomTexts(page);

    // The design frame's own canvas width should match the live viewport
    // it's compared against — when it doesn't (a Figma frame built at the
    // wrong width for its breakpoint), position-based checks lose their
    // 1:1 coordinate assumption and get downgraded rather than trusted.
    const viewport = page.viewportSize();
    const positionReliable = viewport ? Math.abs(tokens.frame.width - viewport.width) / viewport.width < 0.05 : true;

    const findings = diffDesignVsDom(tokens.texts, domTexts, tokens.borders ?? [], { positionReliable });

    // Catch the silent-fallback case: variable font fails to load, browser
    // fakes the weight, computed style still reads correctly.
    const fontFaces = await checkFontFaces(page, tokens.texts);
    const missingFaces = fontFaces.filter((f) => !f.loaded);

    if (missingFaces.length > 0) {
      console.log('\nFONT FACES NOT ACTUALLY LOADED (weight likely faked by the browser):');
      console.table(missingFaces);

      for (const face of missingFaces) {
        findings.push({
          severity: 'P1',
          category: 'font-face-not-loaded',
          text: '',
          detail: `"${face.family}" weight ${face.weight} is not a loaded font face — computed styles may lie about the rendered weight`,
        });
      }
    }

    const bySeverity = {
      P0: findings.filter((f) => f.severity === 'P0'),
      P1: findings.filter((f) => f.severity === 'P1'),
      P2: findings.filter((f) => f.severity === 'P2'),
      P3: findings.filter((f) => f.severity === 'P3'),
    };

    console.log(`\nDESIGN REVIEW — ${slug} / ${breakpoint} (${tokens.frame.width}px)`);
    console.log(
      `P0: ${bySeverity.P0.length}  P1: ${bySeverity.P1.length}  P2: ${bySeverity.P2.length}  P3: ${bySeverity.P3.length}`
    );

    for (const severity of ['P0', 'P1', 'P2'] as const) {
      if (bySeverity[severity].length === 0) continue;

      console.log(`\n${severity}:`);
      console.table(
        bySeverity[severity].map((f) => ({ category: f.category, text: f.text.slice(0, 40), detail: f.detail }))
      );
    }

    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(
      path.join('test-results', `design-review-${slug}-${breakpoint}.json`),
      JSON.stringify({ slug, breakpoint, frame: tokens.frame, findings }, null, 2)
    );

    // P0/P1 are things a user would notice — fail the test on those.
    // P2/P3 are logged and written to the report but don't block the run.
    const blocking: Finding[] = [...bySeverity.P0, ...bySeverity.P1];

    expect.soft(blocking, 'P0/P1 design deviations — see console output above').toEqual([]);
  });
}
