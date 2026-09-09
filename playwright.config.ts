import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 1 : undefined,

  reporter: 'html',

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop',

      use: {
        ...devices['Desktop Chrome'],

        viewport: {
          width: 1440,
          height: 900,
        },
      },
    },
    {
      name: 'tablet',

      // Site's tablet CSS tier is 768-991px (confirmed empirically — font
      // sizes step down right at 768px). 991 is the widest point of that
      // tier, so it's the safest representative width. NOT the same as the
      // Figma "tablet" frame's own canvas width (677px, built narrower than
      // the tier it's meant to represent) — x/y-based spacing checks can be
      // skewed by that mismatch even though font-size/color/text checks
      // aren't affected by it.
      use: {
        ...devices['Desktop Chrome'],

        viewport: {
          width: 991,
          height: 1024,
        },
      },
    },
    {
      name: 'mobile',

      use: {
        ...devices['Desktop Chrome'],

        viewport: {
          width: 375,
          height: 812,
        },
      },
    },
  ],
});