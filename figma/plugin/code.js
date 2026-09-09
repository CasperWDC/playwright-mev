// Design QA token export
//
// Select exactly one frame (a breakpoint frame, e.g. the desktop/tablet/
// mobile version of a page) and run this plugin. It walks the frame and
// extracts the same "design tokens" shape that figma/sync-tokens.js pulls
// from the REST API — text runs (family/weight/size/line-height/letter-
// spacing/position) and auto-layout frames (padding/itemSpacing/position) —
// so the exported JSON is a drop-in replacement for design/<page>/tokens-
// <breakpoint>.json when the REST API is rate-limited.

figma.showUI(__html__, { width: 420, height: 340 });

// Sections excluded from every check — shared components, reviewed once, not per page.
const EXCLUDED_SUBTREES = /^(header|footer)$/i;

// First visible solid fill, as 0-255 RGB + 0-1 alpha — the same shape
// getComputedStyle(el).color parses into on the DOM side. Returns null for
// no fill, a non-solid fill (gradient/image), or a mixed (per-character) fill
// — those need eyeballing, not an automated comparison.
function solidFillToRgba(fills) {
  if (!fills || fills === figma.mixed) return null;

  const fill = fills.find((f) => f.type === 'SOLID' && f.visible !== false);
  if (!fill) return null;

  const { r, g, b } = fill.color;
  const a = fill.opacity !== undefined ? fill.opacity : 1;

  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a };
}

// A node's own visible solid stroke, as {color, weight} — same shape a DOM
// element's uniform border resolves to on the other side. Skips (returns
// null) anything not directly comparable rather than guessing:
// - no stroke, or a non-solid stroke (gradient/image)
// - a mixed stroke (different per edge — Figma only allows independent
//   per-edge SOLID strokes, not truly mixed within one edge, but the weight
//   itself can still be figma.mixed when edges differ)
// - fully transparent (alpha ~0) — not actually visible, not a real border
function solidStrokeInfo(node) {
  if (!('strokes' in node) || node.strokes === figma.mixed) return null;
  if (!('strokeWeight' in node) || node.strokeWeight === figma.mixed) return null;

  const weight = node.strokeWeight;
  if (!weight || weight <= 0) return null;

  const color = solidFillToRgba(node.strokes);
  if (!color || color.a < 0.05) return null;

  return { color, weight };
}

function extractTokens(root) {
  const texts = [];
  const frames = [];
  const borders = [];
  let skippedMixed = 0;

  const originX = root.absoluteBoundingBox.x;
  const originY = root.absoluteBoundingBox.y;

  function walk(node) {
    if (EXCLUDED_SUBTREES.test(node.name || '')) return;

    if (node.type === 'TEXT' && node.absoluteBoundingBox) {
      const box = node.absoluteBoundingBox;

      // A text node with multiple character-level styles (e.g. part bold,
      // part regular) reports figma.mixed for these — can't meaningfully
      // reduce that to one weight/size, so skip it rather than guess.
      const isMixed =
        node.fontName === figma.mixed ||
        node.fontWeight === figma.mixed ||
        node.fontSize === figma.mixed;

      if (isMixed) {
        skippedMixed++;
      } else {
        const lh = node.lineHeight;
        const lineHeight = lh && lh.unit === 'PIXELS' ? lh.value : 0;

        const ls = node.letterSpacing;
        const letterSpacing = ls && ls.unit === 'PIXELS' ? ls.value : 0;

        // Independent of the isMixed check above — a text run can mix bold
        // and underlined spans without mixing font/size, e.g. an inline link.
        const textDecoration = node.textDecoration === figma.mixed ? null : node.textDecoration;

        texts.push({
          name: node.name,
          text: (node.characters || '').trim(),
          fontFamily: node.fontName.family,
          fontWeight: node.fontWeight,
          fontSize: node.fontSize,
          lineHeight,
          letterSpacing,
          textDecoration,
          color: solidFillToRgba(node.fills),
          x: Math.round(box.x - originX),
          y: Math.round(box.y - originY),
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
      }
    }

    if ('layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE' && node.absoluteBoundingBox) {
      const box = node.absoluteBoundingBox;

      frames.push({
        name: node.name,
        layoutMode: node.layoutMode,
        itemSpacing: 'itemSpacing' in node ? node.itemSpacing : null,
        padding: {
          top: 'paddingTop' in node ? node.paddingTop : null,
          right: 'paddingRight' in node ? node.paddingRight : null,
          bottom: 'paddingBottom' in node ? node.paddingBottom : null,
          left: 'paddingLeft' in node ? node.paddingLeft : null,
        },
        x: Math.round(box.x - originX),
        y: Math.round(box.y - originY),
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    }

    // Any node — not just auto-layout frames — can carry a visible border
    // (a button, a badge, an input field, a card). Kept in a separate list
    // from `frames` above: that one is specifically auto-layout metadata,
    // this is purely "does this box have a stroke", regardless of layout mode.
    if (node.absoluteBoundingBox) {
      const strokeInfo = solidStrokeInfo(node);

      if (strokeInfo) {
        const box = node.absoluteBoundingBox;

        borders.push({
          name: node.name,
          color: strokeInfo.color,
          weight: strokeInfo.weight,
          x: Math.round(box.x - originX),
          y: Math.round(box.y - originY),
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
      }
    }

    if ('children' in node) {
      for (const child of node.children) walk(child);
    }
  }

  walk(root);

  return {
    tokens: {
      frame: {
        name: root.name,
        width: Math.round(root.absoluteBoundingBox.width),
        height: Math.round(root.absoluteBoundingBox.height),
      },
      texts,
      frames,
      borders,
    },
    skippedMixed,
  };
}

const selection = figma.currentPage.selection;

if (selection.length !== 1) {
  figma.ui.postMessage({ error: 'Select exactly one frame (the breakpoint frame), then run the plugin again.' });
} else {
  const { tokens, skippedMixed } = extractTokens(selection[0]);
  figma.ui.postMessage({ tokens, frameName: selection[0].name, skippedMixed });
}
