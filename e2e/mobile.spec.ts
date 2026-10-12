import { expect, test } from './fixtures';

test('works on a phone', async ({ studio: page }) => {
  await expect(page.getByRole('button', { name: 'Play (Space)' })).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('tab', { name: 'Create', selected: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.locator('[data-cell][data-row="0"][data-col="1"]').tap();
  await expect(page.locator('[data-cell][data-row="0"][data-col="1"]')).toHaveAttribute('aria-pressed', 'true');
});
