import { readFile } from 'node:fs/promises';
import { expect, kickPad, test } from './fixtures';

test('opens the demo beat', async ({ studio: page }) => {
  await expect(page).toHaveTitle(/Midnight Tape · LofiLoop/);
  await expect(page.getByRole('textbox', { name: 'Beat name' })).toHaveValue('Midnight Tape');
  await expect(page.locator('[data-track-row]')).toHaveCount(7);
});

test('plays and stops with the space bar', async ({ studio: page }) => {
  await page.keyboard.press('Space');
  const stop = page.getByRole('button', { name: 'Stop (Space)' });
  await expect(stop).toBeVisible();
  // The playhead highlights ruler cells as it moves.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('.ruler-cell')].some(
          (el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)',
        ),
      ),
    )
    .toBe(true);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play (Space)' })).toBeVisible();
});

test('paints steps by dragging and undoes the stroke', async ({ studio: page }) => {
  for (const col of [1, 2, 3]) await expect(kickPad(page, col)).toHaveAttribute('aria-pressed', 'false');
  const from = await kickPad(page, 1).boundingBox();
  const to = await kickPad(page, 3).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();
  for (const col of [1, 2, 3]) await expect(kickPad(page, col)).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(kickPad(page, 1)).toHaveAttribute('aria-pressed', 'false');
});

test('edits a step in the step editor', async ({ studio: page }) => {
  await kickPad(page, 2).click({ button: 'right' });
  const editor = page.getByRole('dialog', { name: /Dusty Kick step 3/ });
  await expect(editor).toBeVisible();
  await expect(editor.getByText('Step 3 · off')).toBeVisible();
  // Changing any setting switches the step on.
  await editor.getByRole('radio', { name: '3×' }).click();
  await expect(editor.getByText('Step 3 · on')).toBeVisible();
  await expect(kickPad(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(kickPad(page, 2).locator('span > span')).toHaveCount(3);
  await editor.getByRole('button', { name: 'Turn off' }).click();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(kickPad(page, 2)).toHaveAttribute('aria-pressed', 'false');
});

test('keeps work across reloads', async ({ studio: page }) => {
  const name = page.getByRole('textbox', { name: 'Beat name' });
  await name.fill('Night Bus');
  await name.press('Enter');
  await kickPad(page, 5).click();
  await expect(page.getByText('Saved just now')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Beat name' })).toHaveValue('Night Bus');
  await expect(kickPad(page, 5)).toHaveAttribute('aria-pressed', 'true');
});

test('keyboard shortcuts select patterns and mute tracks', async ({ studio: page }) => {
  await page.keyboard.press('2');
  await expect(page.getByRole('tab', { name: 'B', selected: true })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Mute Dusty Kick' }).first()).toHaveAttribute('aria-pressed', 'true');
});

test('share links open as a copy', async ({ studio: page, context }) => {
  await page.getByRole('button', { name: 'Share link' }).click();
  const link = page.getByRole('textbox', { name: 'Share link' });
  await expect(link).toHaveValue(/#beat=/);
  const url = await link.inputValue();

  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByText(/Opened shared beat “Midnight Tape”/)).toBeVisible();
  await expect(other).toHaveURL(/\/$/);
  await expect(other.locator('[data-track-row]')).toHaveCount(7);
});

test('starts a new beat from a template', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'New beat' }).first().click();
  await page.getByRole('dialog', { name: 'Start a new beat' }).getByRole('button', { name: /^Trap/ }).click();
  await expect(page.getByRole('textbox', { name: 'Beat name' })).not.toHaveValue('Midnight Tape');
  await page.getByRole('button', { name: /^Library/ }).click();
  await expect(page.getByRole('dialog', { name: 'Your beats' }).getByText('Midnight Tape')).toBeVisible();
});

test('exports a WAV file', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export WAV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('midnight-tape-82bpm.wav');
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(1_000_000);
  // Exports are mastered to −14 LUFS by default and report the result.
  await expect(page.getByText(/Export ready\. Mastered to -1[34]\.\d LUFS/)).toBeVisible();
});

test('exports MIDI', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /^MIDI/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export MIDI' }).click(),
  ]);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe('MThd');
});
