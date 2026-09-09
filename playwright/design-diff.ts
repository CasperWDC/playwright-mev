import fs from 'fs';
import { Page } from '@playwright/test';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';

export interface DesignText {
  name: string;
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  // null for a gradient/image fill or a mixed (per-character) fill — those
  // need eyeballing, not an automated comparison. Absent in tokens exported
  // before color capture was added (figma/plugin/code.js), so also optional.
  color?: RgbaColor | null;
  // null when it varies per character (e.g. an inline link inside plain
  // text). Absent in tokens exported before this field was added.
  textDecoration?: TextDecoration | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BorderStyle {
  color: RgbaColor;
  weight: number;
}

// A node with a visible solid stroke, anywhere in the design (not just
// auto-layout frames — a button, badge, input field, or card can all have
// one). Not tied to any particular text; matched to one geometrically at
// diff time (see findEnclosingBorder).
export interface DesignBorder extends BorderStyle {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignTokens {
  frame: { name: string; width: number; height: number };
  texts: DesignText[];
  frames: unknown[];
  // Optional: absent in tokens exported before border capture was added.
  borders?: DesignBorder[];
}

export interface DomText {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  color: RgbaColor;
  textDecoration: TextDecoration;
  // The nearest ancestor (starting at this text's own element) with a
  // uniform border on all four sides — null if none found within the walk
  // depth, or if the nearest bordered ancestor's border isn't uniform (e.g.
  // a top-only divider) and so isn't safely comparable to a single Figma
  // stroke value.
  border: BorderStyle | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Severity = 'P0' | 'P1' | 'P2' | 'P3';

export interface Finding {
  severity: Severity;
  category: string;
  text: string;
  detail: string;
}

// -----------------------------------------------------------------------
// Load a synced tokens file (see figma/sync-tokens.js)
// -----------------------------------------------------------------------

export function loadDesignTokens(filePath: string): DesignTokens {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// -----------------------------------------------------------------------
// DOM extraction — pulls every "leaf" text run and its computed style.
// Runs inside the page. Skips <header>/<footer> per review scope.
// -----------------------------------------------------------------------

export async function extractDomTexts(page: Page): Promise<DomText[]> {
  return page.evaluate(() => {
    const results: DomText[] = [];

    function normalize(s: string) {
      return s.replace(/\s+/g, ' ').trim();
    }

    function isVisible(el: Element) {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (el as HTMLElement).offsetParent !== null;
    }

    // getComputedStyle always resolves to "rgb(r, g, b)" or "rgba(r, g, b, a)".
    function parseColor(css: string) {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m) return { r: 0, g: 0, b: 0, a: 1 };
      const [r, g, b, a] = m[1].split(',').map((n) => parseFloat(n));
      return { r, g, b, a: a === undefined ? 1 : a };
    }

    // textDecorationLine can list multiple values ("underline overline") on
    // an element with several decorations set independently; strikethrough
    // takes visual priority when both are present, same as the Figma enum
    // (a node can't be both at once there).
    function parseTextDecoration(line: string): 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH' {
      if (line.includes('line-through')) return 'STRIKETHROUGH';
      if (line.includes('underline')) return 'UNDERLINE';
      return 'NONE';
    }

    // Walks up from `el` (inclusive) looking for the nearest element with a
    // visible border. Stops and returns it only when all four sides agree on
    // width/style/color — a non-uniform border (e.g. a bottom-only divider)
    // isn't safely reducible to the single {color, weight} shape a Figma
    // stroke compares against, so that case returns null rather than
    // guessing which side is "the" border.
    function findBorder(start: Element) {
      let cur: Element | null = start;
      let depth = 0;

      while (cur && depth < 8) {
        const s = window.getComputedStyle(cur);
        const widths = [
          parseFloat(s.borderTopWidth),
          parseFloat(s.borderRightWidth),
          parseFloat(s.borderBottomWidth),
          parseFloat(s.borderLeftWidth),
        ];
        const styles = [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle];
        const colors = [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];

        const hasBorder = widths.some((w) => w > 0) && styles.some((st) => st !== 'none');

        if (hasBorder) {
          const uniform =
            widths.every((w) => Math.abs(w - widths[0]) < 0.5) &&
            styles.every((st) => st === styles[0]) &&
            colors.every((c) => c === colors[0]);

          return uniform ? { color: parseColor(colors[0]), weight: widths[0] } : null;
        }

        cur = cur.parentElement;
        depth++;
      }

      return null;
    }

    function walk(el: Element) {
      // The site nav is a `nav.main_nav` (not a semantic <header>), including
      // its mega-menu dropdowns.
      if (el.closest('header, footer, nav.main_nav')) return;

      const directText = normalize(
        Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent || '')
          .join(' ')
      );

      if (directText && isVisible(el)) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        results.push({
          text: normalize(el.textContent || ''),
          fontFamily: style.fontFamily,
          fontWeight: parseInt(style.fontWeight, 10) || 400,
          fontSize: parseFloat(style.fontSize) || 0,
          lineHeight: parseFloat(style.lineHeight) || 0,
          letterSpacing: style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) || 0,
          color: parseColor(style.color),
          textDecoration: parseTextDecoration(style.textDecorationLine),
          border: findBorder(el),
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }

      for (const child of Array.from(el.children)) {
        walk(child);
      }
    }

    walk(document.body);

    return results;
  });
}

// -----------------------------------------------------------------------
// Font-face verification — variable fonts (Google Sans Flex) fake a weight
// client-side when the real weight file fails to load, and computed
// font-weight still reads correctly. document.fonts.check() catches that.
// -----------------------------------------------------------------------

export interface FontFaceCheck {
  family: string;
  weight: number;
  loaded: boolean;
}

export async function checkFontFaces(page: Page, designTexts: DesignText[]): Promise<FontFaceCheck[]> {
  const uniquePairs = new Map<string, { family: string; weight: number }>();

  for (const t of designTexts) {
    const key = `${t.fontFamily}__${t.fontWeight}`;
    if (!uniquePairs.has(key)) uniquePairs.set(key, { family: t.fontFamily, weight: t.fontWeight });
  }

  const pairs = Array.from(uniquePairs.values());

  return page.evaluate((pairs) => {
    return pairs.map(({ family, weight }) => ({
      family,
      weight,
      loaded: document.fonts.check(`${weight} 16px "${family}"`),
    }));
  }, pairs);
}

// -----------------------------------------------------------------------
// Matching + diffing
// -----------------------------------------------------------------------

// Strips to ASCII letters/digits/space only. This also absorbs mojibake from
// copy-pasted design text (curly quotes/em-dashes turning into stray bytes
// like "â") since the same stripping collapses both sides to the same key.
function normalizeText(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFamily(f: string) {
  return f.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
}

interface MatchResult {
  matched: Array<{ design: DesignText; dom: DomText; ambiguous: boolean }>;
  unmatchedDesign: DesignText[];
  unmatchedDom: DomText[];
}

// Below this many alnum characters, a normalized key is too generic to
// match reliably ("01", "/", "[") — the same short label recurs in
// unrelated sections of the page and produces cross-matched false positives.
const MIN_MATCHABLE_KEY_LENGTH = 4;

// Groups both sides by normalized text, then pairs occurrences in reading
// order (top-to-bottom). Handles repeated strings (e.g. a name used twice)
// as long as relative order matches between design and build.
function matchTexts(designTexts: DesignText[], domTexts: DomText[]): MatchResult {
  const byDesignOrder = [...designTexts].sort((a, b) => a.y - b.y || a.x - b.x);
  const byDomOrder = [...domTexts].sort((a, b) => a.y - b.y || a.x - b.x);

  const domGroups = new Map<string, DomText[]>();
  for (const d of byDomOrder) {
    const key = normalizeText(d.text);
    if (key.replace(/\s/g, '').length < MIN_MATCHABLE_KEY_LENGTH) continue;
    if (!domGroups.has(key)) domGroups.set(key, []);
    domGroups.get(key)!.push(d);
  }

  // How many times each key appears on the design side and (originally) on
  // the DOM side. A key with >1 occurrence on either side is ambiguous: the
  // same copy shows up in multiple components (nav + footer + card tags,
  // etc.) with potentially different styling, and FIFO pairing by document
  // order can pick the wrong instance. Findings on such pairs are reported
  // but not trusted enough to block the run.
  const designKeyCounts = new Map<string, number>();
  for (const d of byDesignOrder) {
    const key = normalizeText(d.text);
    designKeyCounts.set(key, (designKeyCounts.get(key) ?? 0) + 1);
  }
  const domKeyCounts = new Map<string, number>();
  for (const [key, group] of domGroups) domKeyCounts.set(key, group.length);

  const matched: Array<{ design: DesignText; dom: DomText; ambiguous: boolean }> = [];
  const unmatchedDesign: DesignText[] = [];

  for (const design of byDesignOrder) {
    if (!design.text) continue;

    const key = normalizeText(design.text);

    if (key.replace(/\s/g, '').length < MIN_MATCHABLE_KEY_LENGTH) continue;

    const group = domGroups.get(key);

    if (group && group.length > 0) {
      const ambiguous = (designKeyCounts.get(key) ?? 0) > 1 || (domKeyCounts.get(key) ?? 0) > 1;
      matched.push({ design, dom: group.shift()!, ambiguous });
    } else {
      unmatchedDesign.push(design);
    }
  }

  const unmatchedDom = Array.from(domGroups.values()).flat();

  return { matched, unmatchedDesign, unmatchedDom };
}

const FONT_SIZE_P1_THRESHOLD = 2; // px
const FONT_SIZE_P2_THRESHOLD = 1; // px
// Both sides are exact CSS values (not rasterized pixels), so a real color
// mismatch is usually way past this — this just absorbs float→8bit rounding
// between Figma's 0-1 channel and the browser's 0-255 one.
const COLOR_CHANNEL_THRESHOLD = 4; // out of 255
const COLOR_ALPHA_THRESHOLD = 0.02;

function colorsDiffer(a: RgbaColor, b: RgbaColor): boolean {
  return (
    Math.abs(a.r - b.r) > COLOR_CHANNEL_THRESHOLD ||
    Math.abs(a.g - b.g) > COLOR_CHANNEL_THRESHOLD ||
    Math.abs(a.b - b.b) > COLOR_CHANNEL_THRESHOLD ||
    Math.abs(a.a - b.a) > COLOR_ALPHA_THRESHOLD
  );
}

function formatColor(c: RgbaColor): string {
  return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a.toFixed(2)})` : `rgb(${c.r}, ${c.g}, ${c.b})`;
}

// Line count rather than literal wrap position: Figma and the browser hint
// and kern glyphs differently, so an identical box width and font can still
// break a line one glyph earlier/later between the two — comparing exact
// break points would be near-permanent noise. Line count is what actually
// signals a layout problem (a heading spilling to a 3rd line, a label
// unexpectedly collapsing to one).
function lineCount(heightPx: number, lineHeightPx: number): number | null {
  if (lineHeightPx <= 0) return null;
  return Math.round(heightPx / lineHeightPx);
}
const SPACING_P2_THRESHOLD = 8; // px — below this is rounding/font-metric noise (per skill)
const SPACING_NOT_VERIFIABLE_THRESHOLD = 500; // px — almost certainly a mismatched pair, not real spacing
const BORDER_WEIGHT_THRESHOLD = 1; // px

// A border only counts as "this text's own container" (a button, badge,
// input field, card) if it tightly wraps the text — not e.g. a whole
// section's outer frame, which would otherwise get matched to every single
// text inside it and produce a "missing border" finding for all of them.
// 6x the text's own area comfortably covers typical padding around a short
// label without admitting full-width containers.
const BORDER_ENCLOSING_MAX_AREA_RATIO = 6;

// Smallest design border whose box tightly contains this text — the border
// most likely to be "this text's own" rather than some unrelated ancestor
// section that merely happens to overlap it. Returns undefined when no
// border qualifies, which just means there's nothing to check here (most
// text on a page isn't inside a bordered box).
function findEnclosingBorder(text: DesignText, borders: DesignBorder[]): DesignBorder | undefined {
  const textArea = Math.max(text.width * text.height, 1);
  const SLACK = 2; // px — rounding between Figma's float box and the rounded int we stored

  let best: DesignBorder | undefined;
  let bestArea = Infinity;

  for (const b of borders) {
    const contains =
      b.x - SLACK <= text.x &&
      b.y - SLACK <= text.y &&
      b.x + b.width + SLACK >= text.x + text.width &&
      b.y + b.height + SLACK >= text.y + text.height;

    if (!contains) continue;

    const area = b.width * b.height;
    if (area / textArea > BORDER_ENCLOSING_MAX_AREA_RATIO) continue;

    if (area < bestArea) {
      bestArea = area;
      best = b;
    }
  }

  return best;
}

// The page's H1 is the only text that renders at its exact Figma weight.
// Identified structurally (largest font size on the frame; topmost if tied)
// rather than by literal copy, so it still works if the headline changes.
function findH1(designTexts: DesignText[]): DesignText | undefined {
  const maxFontSize = Math.max(...designTexts.map((t) => t.fontSize));
  const candidates = designTexts.filter((t) => t.fontSize === maxFontSize);
  return candidates.sort((a, b) => a.y - b.y)[0];
}

// Below this, every sample on this page turned out to be a micro-label
// baked into an infographic image (vendor logos, tiny diagram callouts —
// "Marriott" 7px, "SFTP" 7px, "PMS Platforms" 8px), never live text; the
// smallest real UI copy on the page is 12px. Reported as not-verifiable
// rather than silently dropped, so a genuine future 7px text block still shows up.
const NOT_VERIFIABLE_FONT_SIZE = 9;

const CYRILLIC = /[а-яА-ЯёЁ]/;
const LATIN = /[a-zA-Z]/;

// Homoglyph typo: a Cyrillic letter pasted into an English word because it
// looks identical to a Latin one (Сase -> Сase with a Cyrillic С, U+0421).
// Invisible by eye, breaks search/selection/screen readers. Checked on the
// live DOM only — the design side flags the same shared master-template
// content on every page it's reused on, which isn't fixable from here; the
// live page is where a real, page-specific typo (a bad content edit) shows up.
function checkMixedScript(texts: Array<{ text: string }>): Finding[] {
  const findings: Finding[] = [];

  for (const t of texts) {
    for (const word of t.text.split(/\s+/)) {
      if (!CYRILLIC.test(word) || !LATIN.test(word)) continue;

      const flagged = [...word].filter((ch) => CYRILLIC.test(ch));

      findings.push({
        severity: 'P1',
        category: 'mixed-script',
        text: t.text,
        detail: `"${word}" mixes Cyrillic and Latin letters — likely a homoglyph typo (${flagged
          .map((ch) => `"${ch}" U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
          .join(', ')}), not visually distinguishable from the intended Latin letter`,
      });
    }
  }

  return findings;
}

export interface DiffOptions {
  // False when the design frame's own canvas width doesn't match the live
  // viewport it's being compared against (see design-tokens.spec.ts) — e.g.
  // a "tablet" Figma frame built at 677px compared against a live page
  // rendered at 991px. Position-based checks (horizontal offset, vertical
  // gap) assume the two coordinate spaces line up 1:1; when they don't, a
  // width-driven reflow can shift everything on its own, unrelated to any
  // real spacing bug — so those findings are capped to P3 instead of
  // skipped outright, since they can still hint at something worth an
  // eyeball, just not enough to block on.
  positionReliable?: boolean;
}

export function diffDesignVsDom(
  designTexts: DesignText[],
  domTexts: DomText[],
  designBorders: DesignBorder[] = [],
  options: DiffOptions = {}
): Finding[] {
  const positionReliable = options.positionReliable ?? true;
  const verifiable = designTexts.filter((t) => t.fontSize >= NOT_VERIFIABLE_FONT_SIZE);
  const tooSmallToVerify = designTexts.filter((t) => t.fontSize < NOT_VERIFIABLE_FONT_SIZE);

  const { matched, unmatchedDesign, unmatchedDom } = matchTexts(verifiable, domTexts);
  const findings: Finding[] = [...checkMixedScript(domTexts)];
  const h1 = findH1(designTexts);

  for (const skipped of tooSmallToVerify) {
    findings.push({
      severity: 'P3',
      category: 'not-verifiable',
      text: skipped.text,
      detail: `${skipped.fontSize}px is below the infographic-label threshold (${NOT_VERIFIABLE_FONT_SIZE}px) — likely baked into an image, not checked`,
    });
  }

  // Copy must match the design exactly. Some of these will be nodes that
  // are genuinely rendered as an image on the page, or leftover placeholder
  // content from a duplicated Figma frame — those are real data-quality
  // issues in the source tokens, not false positives, so they're still
  // reported (fix by removing the stale node in Figma and re-syncing).
  for (const missing of unmatchedDesign) {
    findings.push({
      severity: 'P1',
      category: 'missing-content',
      text: missing.text,
      detail: `Design text not found on the page: "${missing.text}" (Figma source: ${missing.fontSize}px / weight ${missing.fontWeight} — not a live-page comparison, just where to find it in the design)`,
    });
  }

  for (const { design, dom, ambiguous } of matched) {
    // This exact copy appears more than once (nav + footer + card tags,
    // etc.) on at least one side, so the FIFO pairing above may have picked
    // the wrong instance. Cap severity so an ambiguous pair can never block
    // the run — surfaced in the report for a human to verify, not asserted on.
    const cap = (severity: Severity): Severity => (ambiguous ? 'P3' : severity);

    // Font family
    const designFamily = normalizeFamily(design.fontFamily);
    const domFamily = normalizeFamily(dom.fontFamily);

    if (!domFamily.includes(designFamily) && !designFamily.includes(domFamily)) {
      findings.push({
        severity: cap('P0'),
        category: 'font-family',
        text: design.text,
        detail: `Expected "${design.fontFamily}", got "${dom.fontFamily}"${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}`,
      });
    }

    // Font weight — confirmed build convention (not a bug): every weight
    // renders one CSS step lighter than Figma (500->400, 400->300, 600->500),
    // except the H1, which is the only element expected to match exactly.
    const isH1 = design === h1;
    const weightDiff = design.fontWeight - dom.fontWeight;

    if (isH1 && weightDiff !== 0) {
      findings.push({
        severity: cap('P1'),
        category: 'font-weight',
        text: design.text,
        detail: `H1 weight expected to match exactly: expected ${design.fontWeight}, got ${dom.fontWeight}`,
      });
    } else if (!isH1 && weightDiff !== 0 && weightDiff !== 100) {
      findings.push({
        severity: 'P2',
        category: 'font-weight',
        text: design.text,
        detail: `Expected ${design.fontWeight} (or ${design.fontWeight - 100} one step lighter, per convention), got ${dom.fontWeight}`,
      });
    }

    // Font size
    const sizeDiff = Math.abs(design.fontSize - dom.fontSize);

    if (sizeDiff > FONT_SIZE_P1_THRESHOLD) {
      findings.push({
        severity: cap('P1'),
        category: 'font-size',
        text: design.text,
        detail: `Expected ${design.fontSize}px, got ${dom.fontSize}px${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}`,
      });
    } else if (sizeDiff > FONT_SIZE_P2_THRESHOLD) {
      findings.push({
        severity: 'P2',
        category: 'font-size',
        text: design.text,
        detail: `Expected ${design.fontSize}px, got ${dom.fontSize}px`,
      });
    }

    // Color — skipped when the design side has no single solid fill
    // (gradient/image fill, or mixed per-character color) to compare against.
    if (design.color && colorsDiffer(design.color, dom.color)) {
      findings.push({
        severity: cap('P1'),
        category: 'color',
        text: design.text,
        detail: `Expected ${formatColor(design.color)}, got ${formatColor(dom.color)}${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}`,
      });
    }

    // Underline / strikethrough — skipped when it varies per character on
    // the design side (e.g. an inline link inside plain text).
    if (design.textDecoration && design.textDecoration !== dom.textDecoration) {
      findings.push({
        severity: cap('P1'),
        category: 'text-decoration',
        text: design.text,
        detail: `Expected ${design.textDecoration}, got ${dom.textDecoration}${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}`,
      });
    }

    // Line count — see lineCount() above for why not exact wrap position.
    const designLines = lineCount(design.height, design.lineHeight);
    const domLines = lineCount(dom.height, dom.lineHeight);

    if (designLines !== null && domLines !== null && designLines !== domLines) {
      findings.push({
        severity: cap('P2'),
        category: 'line-wrap',
        text: design.text,
        detail: `Expected to wrap to ${designLines} line${designLines === 1 ? '' : 's'}, got ${domLines}${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}`,
      });
    }

    // Border — only asserted when this text sits inside a tight design
    // border (see findEnclosingBorder); most text isn't, and this stays
    // silent for it rather than guessing at an unrelated container.
    const enclosingBorder = findEnclosingBorder(design, designBorders);

    if (enclosingBorder) {
      if (!dom.border) {
        findings.push({
          severity: cap('P2'),
          category: 'border',
          text: design.text,
          detail: `Expected a ${enclosingBorder.weight}px ${formatColor(enclosingBorder.color)} border around this ("${enclosingBorder.name}" in Figma), found none on the page${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}`,
        });
      } else if (
        Math.abs(enclosingBorder.weight - dom.border.weight) > BORDER_WEIGHT_THRESHOLD ||
        colorsDiffer(enclosingBorder.color, dom.border.color)
      ) {
        findings.push({
          severity: cap('P2'),
          category: 'border',
          text: design.text,
          detail: `Expected ${enclosingBorder.weight}px ${formatColor(enclosingBorder.color)} border, got ${dom.border.weight}px ${formatColor(dom.border.color)}${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}`,
        });
      }
    }

    // Horizontal position — both x's are page/frame-left-edge relative, so
    // this is a direct proxy for "left margin/padding/indent", whatever
    // mechanism actually produced it in either the design or the build.
    // Same reliability caveat as the vertical-gap check below.
    const xDiff = Math.abs(design.x - dom.x);

    if (xDiff > SPACING_NOT_VERIFIABLE_THRESHOLD) {
      findings.push({
        severity: 'P3',
        category: 'spacing-not-verifiable',
        text: design.text,
        detail: `Left offset expected ${design.x}px, got ${dom.x}px — likely a mismatched pair, not real spacing`,
      });
    } else if (xDiff > SPACING_P2_THRESHOLD) {
      findings.push({
        severity: positionReliable ? cap('P2') : 'P3',
        category: 'spacing',
        text: design.text,
        detail: `Left offset expected ${design.x}px, got ${dom.x}px${ambiguous ? ' (ambiguous match — this text repeats elsewhere on the page)' : ''}${positionReliable ? '' : ' (design canvas width differs from the live viewport — low confidence)'}`,
      });
    }
  }

  // Vertical rhythm — compare the gap between consecutive matched texts
  // (design order) against the same gap on the page. Never treated as
  // blocking (P0/P1): duplicate content blocks on this page (testimonials,
  // footer contact info appearing twice) make text-matching order occasionally
  // pair the wrong instance, producing gaps of hundreds/thousands of px that
  // are a matching artifact, not a real layout bug. Cross-check by eye against
  // the pixel-diff screenshot before acting on any of these.
  const orderedMatches = [...matched].sort((a, b) => a.design.y - b.design.y);

  for (let i = 1; i < orderedMatches.length; i++) {
    const prev = orderedMatches[i - 1];
    const curr = orderedMatches[i];

    const designGap = curr.design.y - prev.design.y;
    const domGap = curr.dom.y - prev.dom.y;
    const gapDiff = Math.abs(designGap - domGap);

    if (gapDiff > SPACING_NOT_VERIFIABLE_THRESHOLD) {
      findings.push({
        severity: 'P3',
        category: 'spacing-not-verifiable',
        text: curr.design.text,
        detail: `Gap after "${prev.design.text.slice(0, 30)}" expected ${designGap}px, got ${domGap}px — likely a mismatched pair (duplicate content), not a real gap`,
      });
    } else if (gapDiff > SPACING_P2_THRESHOLD) {
      findings.push({
        severity: positionReliable ? 'P2' : 'P3',
        category: 'spacing',
        text: curr.design.text,
        detail: `Gap after "${prev.design.text.slice(0, 30)}" expected ${designGap}px, got ${domGap}px${positionReliable ? '' : ' (design canvas width differs from the live viewport — low confidence)'}`,
      });
    }
  }

  // Extra content on the page with no design counterpart. Not blocking on
  // its own (dynamic content — dates, cookie banners — legitimately isn't
  // tracked in Figma), but printed: when it's the replacement for a
  // "missing-content" finding above (copy was edited), seeing both together
  // is what makes the change obvious.
  for (const extra of unmatchedDom) {
    findings.push({
      severity: 'P2',
      category: 'extra-content',
      text: extra.text,
      detail: `On the page but not matched to any design text: "${extra.text.slice(0, 60)}"`,
    });
  }

  return findings;
}
