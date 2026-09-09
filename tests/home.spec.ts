import { test, expect } from '@playwright/test';

test('homepage loads correctly', async ({ page }) => {

  await page.goto('https://mev.com/');

  await expect(page).toHaveTitle(/./);

  await expect(page.locator('body')).toBeVisible();

});