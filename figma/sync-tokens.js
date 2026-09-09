// Pulls typography + auto-layout spacing values straight from Figma nodes
// and stores them as flat JSON "design tokens" the Playwright specs assert against.
//
// Usage: npm run figma:sync

const fs = require('fs');
const path = require('path');

function loadEnvToken() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;

  const envPath = path.join(__dirname, '..', '.env');
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('FIGMA_TOKEN='));

  if (!line) {
    throw new Error('FIGMA_TOKEN not found in .env');
  }

  return line.slice('FIGMA_TOKEN='.length).trim();
}

const FIGMA_TOKEN = loadEnvToken();
const FILE_KEY = 'q7aRSCm8cDmhPIka1tlyHY';

// Sections excluded from every check — shared components, reviewed once, not per page.
const EXCLUDED_SUBTREES = /^(header|footer)$/i;

const PAGES = {
  'focal-revenue': {
    desktop: '1:3927',
    tablet: '1:5434',
    mobile: '1:6170',
  },
};

// Renders a node to PNG via Figma's image API, at 1x scale so pixel
// dimensions line up with the frame's own width (== the test viewport width).
async function fetchRenderedPng(nodeId) {
  const renderUrl = `https://api.figma.com/v1/images/${FILE_KEY}?ids=${nodeId}&format=png&scale=1`;

  const renderRes = await fetchWithRetry(renderUrl, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });

  if (!renderRes.ok) {
    throw new Error(`Figma image API ${renderRes.status}: ${await renderRes.text()}`);
  }

  const renderData = await renderRes.json();
  const imageUrl = renderData.images[nodeId];

  if (!imageUrl) {
    throw new Error(`Figma did not return a render for node ${nodeId}: ${JSON.stringify(renderData)}`);
  }

  const imageRes = await fetch(imageUrl);

  if (!imageRes.ok) {
    throw new Error(`Failed to download rendered PNG: ${imageRes.status}`);
  }

  return Buffer.from(await imageRes.arrayBuffer());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 6) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);

    if (res.status !== 429) return res;

    const waitMs = Math.min(15000 * 2 ** attempt, 120000);
    console.log(`  rate limited, retrying in ${waitMs / 1000}s...`);
    await sleep(waitMs);
  }

  throw new Error('Figma API rate limit exceeded after retries');
}

async function fetchNode(nodeId) {
  const url = `https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${nodeId}`;

  const res = await fetchWithRetry(url, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });

  if (!res.ok) {
    throw new Error(`Figma API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const entry = data.nodes[nodeId];

  if (!entry) {
    throw new Error(`Node ${nodeId} not found in file ${FILE_KEY}`);
  }

  return entry.document;
}

function extractTokens(root) {
  const texts = [];
  const frames = [];

  const originX = root.absoluteBoundingBox.x;
  const originY = root.absoluteBoundingBox.y;

  function walk(node) {
    if (EXCLUDED_SUBTREES.test(node.name || '')) return;

    if (node.type === 'TEXT' && node.style && node.absoluteBoundingBox) {
      const box = node.absoluteBoundingBox;

      texts.push({
        name: node.name,
        text: (node.characters || '').trim(),
        fontFamily: node.style.fontFamily,
        fontWeight: node.style.fontWeight,
        fontSize: node.style.fontSize,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
        x: Math.round(box.x - originX),
        y: Math.round(box.y - originY),
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    }

    if (node.layoutMode && node.layoutMode !== 'NONE' && node.absoluteBoundingBox) {
      const box = node.absoluteBoundingBox;

      frames.push({
        name: node.name,
        layoutMode: node.layoutMode,
        itemSpacing: node.itemSpacing ?? null,
        padding: {
          top: node.paddingTop ?? null,
          right: node.paddingRight ?? null,
          bottom: node.paddingBottom ?? null,
          left: node.paddingLeft ?? null,
        },
        x: Math.round(box.x - originX),
        y: Math.round(box.y - originY),
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    }

    for (const child of node.children || []) {
      walk(child);
    }
  }

  walk(root);

  return {
    frame: {
      name: root.name,
      width: Math.round(root.absoluteBoundingBox.width),
      height: Math.round(root.absoluteBoundingBox.height),
    },
    texts,
    frames,
  };
}

async function main() {
  for (const [pageName, breakpoints] of Object.entries(PAGES)) {
    const outDir = path.join(__dirname, '..', 'design', pageName);
    fs.mkdirSync(outDir, { recursive: true });

    for (const [bp, nodeId] of Object.entries(breakpoints)) {
      await sleep(500);
      process.stdout.write(`Fetching ${pageName} / ${bp} (${nodeId})... `);

      const root = await fetchNode(nodeId);
      const tokens = extractTokens(root);

      const outPath = path.join(outDir, `tokens-${bp}.json`);
      fs.writeFileSync(outPath, JSON.stringify(tokens, null, 2));

      console.log(`${tokens.texts.length} text nodes, ${tokens.frames.length} layout frames -> ${outPath}`);

      // The desktop reference PNG was hand-exported and is already wired into
      // focal.spec.ts — don't clobber it. Only auto-render the new breakpoints.
      if (bp !== 'desktop') {
        const pngPath = path.join(outDir, `${pageName}-design-${bp}.png`);
        const png = await fetchRenderedPng(nodeId);
        fs.writeFileSync(pngPath, png);
        console.log(`  rendered PNG -> ${pngPath}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
