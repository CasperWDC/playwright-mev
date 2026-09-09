export interface PageUnderTest {
  // Used as the design/<slug>/ folder name and in report/screenshot filenames.
  slug: string;
  url: string;
}

// Add a page here once its Figma tokens exist at design/<slug>/tokens-<bp>.json
// (see figma/plugin/ — run it on the desktop/tablet/mobile frames and drop the
// downloaded JSON into that folder) to bring it into both design-tokens.spec.ts
// and pixel-diff.spec.ts automatically, across all breakpoint projects.
export const PAGES: PageUnderTest[] = [
  { slug: 'cartier', url: 'https://mev-stage.webflow.io/private-pages/cartier' },
  { slug: 'open-study', url: 'https://mev-stage.webflow.io/private-pages/open-study' },
];
