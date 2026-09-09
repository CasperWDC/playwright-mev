import { Page } from '@playwright/test';

// Logs in, accepts cookies, forces lazy-loaded content in, and waits for
// fonts/animations to settle. Shared by every spec that hits a private page.
export async function openAndPrepare(page: Page, url: string) {
  await page.goto(url);

  await page.getByRole('textbox', { name: 'Password' }).fill('123');
  await page.getByRole('button', { name: 'Submit' }).click();

  await page.getByRole('button', { name: 'Accept All' }).click();

  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 500;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });

  await page.evaluate(() => window.scrollTo(0, 0));

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await page.waitForTimeout(1000);

  await page.addStyleTag({
    content: `
      html { scrollbar-width: none !important; }
      ::-webkit-scrollbar { display: none !important; }
    `,
  });
}
