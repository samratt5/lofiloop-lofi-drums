import { expect, test } from '@playwright/test';

test('shows the tour on a first visit, once', async ({ page }) => {
  await page.goto('/');
  const card = page.getByRole('dialog', { name: 'Welcome to LofiLoop' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Play and stop' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Play and stop' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('grid', { name: /Pattern A steps/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog', { name: 'Welcome to LofiLoop' })).toBeHidden();
});
