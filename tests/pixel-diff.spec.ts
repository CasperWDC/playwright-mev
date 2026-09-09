import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { compareImages } from '../playwright/image-compare';
import { openAndPrepare } from '../playwright/page-ready';
import { PAGES } from '../playwright/pages';

// Full-page pixel diff against a Figma-exported reference PNG. Runs once per
// page (playwright/pages.ts) per breakpoint project (desktop/tablet/mobile).
//
// Desktop PNGs are hand-exported from Figma; tablet/mobile can be either
// hand-exported the same way, or auto-rendered by figma/sync-tokens.js
// (npm run figma:sync) once Figma API access is available. Either way they
// live at design/<slug>/<slug>-design[-<breakpoint>].png.

for (const { slug, url } of PAGES) {
  test(`${slug} — pixel diff`, async ({ page }, testInfo) => {
    const breakpoint = testInfo.project.name; // 'desktop' | 'tablet' | 'mobile'

    const referencePath =
      breakpoint === 'desktop'
        ? path.join('design', slug, `${slug}-design.png`)
        : path.join('design', slug, `${slug}-design-${breakpoint}.png`);

    test.skip(
      !fs.existsSync(referencePath),
      `No reference PNG yet at ${referencePath} — export the ${breakpoint} frame from Figma (or run npm run figma:sync) and drop it there.`
    );

    // --------------------------------------------------
    // Open, log in, accept cookies, settle page
    // --------------------------------------------------

    await openAndPrepare(page, url);

    await expect(page).toHaveTitle(/.+/);

    // --------------------------------------------------
    // Image report
    // --------------------------------------------------

    const imageReport = await page.evaluate(() => {
      return Array.from(document.images).map((img) => ({
        src: img.currentSrc || img.src,
        loaded: img.complete && img.naturalWidth > 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
        visible: !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length),
      }));
    });

    console.log('\nIMAGE REPORT:\n');
    console.table(imageReport);

    // --------------------------------------------------
    // Browser / viewport information
    // --------------------------------------------------

    const viewport = page.viewportSize();

    const browserInfo = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      devicePixelRatio: window.devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
    }));

    console.log('\nVIEWPORT:\n');
    console.table({ configuredWidth: viewport?.width, configuredHeight: viewport?.height, ...browserInfo });

    fs.mkdirSync('test-results', { recursive: true });

    const sections = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('section, main > div, [class*="section"]'))
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return {
            index,
            tag: element.tagName,
            className: typeof element.className === 'string' ? element.className : '',
            top: Math.round(rect.top + window.scrollY),
            height: Math.round(rect.height),
            bottom: Math.round(rect.bottom + window.scrollY),
            marginTop: style.marginTop,
            marginBottom: style.marginBottom,
            paddingTop: style.paddingTop,
            paddingBottom: style.paddingBottom,
          };
        })
        .filter((section) => section.height > 0);
    });

    console.log('\nPAGE SECTIONS:\n');
    console.table(sections);

    // --------------------------------------------------
    // Actual website screenshot
    // --------------------------------------------------

    const actualPath = path.join('test-results', `${slug}-actual-${breakpoint}.png`);

    await page.screenshot({ path: actualPath, fullPage: true });

    // --------------------------------------------------
    // Compare Figma vs website
    // --------------------------------------------------

    const diffPath = path.join('test-results', `${slug}-diff-${breakpoint}.png`);

    const result = compareImages(referencePath, actualPath, diffPath);

    console.log(`Reference: ${result.referenceWidth}x${result.referenceHeight}`);
    console.log(`Actual: ${result.actualWidth}x${result.actualHeight}`);
    console.log(`Compared: ${result.comparedWidth}x${result.comparedHeight}`);
    console.log(`Mismatched pixels: ${result.mismatchedPixels}`);
    console.log(`Total pixels: ${result.totalPixels}`);
    console.log(`Visual difference: ${result.mismatchPercentage.toFixed(2)}%`);
  });
}
