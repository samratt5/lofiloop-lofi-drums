import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

/** A short mono 16-bit WAV of four clicks, built in memory for the sampler. */
function clickLoop(): Buffer {
  const rate = 22050;
  const frames = rate * 2;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + frames * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = (i % (rate / 2)) / rate;
    const v = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 30) * 0.8;
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return data;
}

test('writes a full song from a description', async ({ studio: page }) => {
  await page.getByLabel('Describe your song').fill('sad rainy jazz, 3 minutes');
  await expect(page.getByRole('list', { name: 'Understood' })).toContainText('jazz');
  await page.getByRole('button', { name: 'Generate song' }).click();
  await expect(page.getByRole('radio', { name: 'Arrangement', checked: true })).toBeVisible();
  const status = page.getByText(/^\d:\d\d · \d+ bars · \d+ sections$/);
  await expect(status).toBeVisible();
  const [, minutes, seconds] = (await status.innerText()).match(/^(\d):(\d\d)/)!;
  expect(Number(minutes) * 60 + Number(seconds)).toBeGreaterThanOrEqual(150);

  // Regenerate one section; it's a single undo step.
  await page.getByRole('button', { name: /^Verse 1, / }).click();
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Undo/ })).toBeEnabled();
});

test('saves a version and compares it', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Versions & A/B compare' }).click();
  const dialog = page.getByRole('dialog', { name: 'Versions' });
  await dialog.getByLabel('Version name').fill('Before drums');
  await dialog.getByRole('button', { name: 'Save version' }).click();
  await expect(dialog.getByText('Before drums')).toBeVisible();
  await dialog.getByRole('button', { name: 'A/B', exact: true }).click();
  const compare = page.getByRole('region', { name: 'A/B compare' });
  await expect(compare.getByRole('button', { name: /B Before drums/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(compare.getByRole('button', { name: /A Now/ })).toHaveAttribute('aria-pressed', 'true');
  await compare.getByRole('button', { name: 'Stop comparing' }).click();
  await expect(compare).toBeHidden();
});

test('listens to the Discover gallery and opens a song', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Discover & radio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discover' });
  await dialog
    .getByRole('button', { name: /^Listen to / })
    .first()
    .click();
  const player = page.getByRole('region', { name: 'Now playing' });
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(player).toContainText('Discover · 1 of 12');
  await player.getByRole('button', { name: 'Next' }).click();
  await expect(player).toContainText('2 of 12');
  await player.getByRole('button', { name: 'Open in the studio' }).click();
  await expect(player).toBeHidden();
  await expect(page.getByText(/Opened “.+” in the studio/)).toBeVisible();
});

test('plays endless radio', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Discover & radio' }).click();
  await page.getByRole('button', { name: /^Jazz café/ }).click();
  const player = page.getByRole('region', { name: 'Now playing' });
  await expect(player).toContainText('Radio · Jazz café');
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(player.getByRole('button', { name: 'Play' })).toBeVisible();
  await player.getByRole('button', { name: 'Stop listening' }).click();
});

test('records from the computer keyboard', async ({ studio: page }) => {
  const keys = page.locator('[data-cell][data-row="4"][aria-pressed="true"]');
  const before = await keys.count();
  await page.getByText('Electric Piano', { exact: true }).first().click();
  await page.keyboard.press('p');
  const dock = page.getByRole('region', { name: 'Keyboard' });
  await expect(dock).toBeVisible();
  await dock.getByLabel('Count-in', { exact: true }).selectOption('0');
  await dock.getByLabel('Quantize', { exact: true }).selectOption('1');
  await dock.getByRole('button', { name: /^Record/ }).click();
  await expect(dock.getByText(/^Recording/)).toBeVisible();
  for (const key of ['KeyZ', 'KeyC', 'KeyB', 'KeyQ', 'KeyE', 'KeyT']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(120);
    await page.keyboard.up(key);
    await page.waitForTimeout(260);
  }
  await dock.getByRole('button', { name: 'Stop recording' }).click();
  await page.keyboard.press('Escape');
  await expect(dock).toBeHidden();
  expect(await keys.count()).toBeGreaterThan(before);
});

test('loads, chops and plays a sample', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Add track' }).click();
  await page
    .getByRole('dialog', { name: 'Choose an instrument' })
    .getByRole('button', { name: /Sampler/ })
    .click();
  await page.locator('input[type=file][accept^="audio"]').setInputFiles({
    name: 'clicks.wav',
    mimeType: 'audio/wav',
    buffer: clickLoop(),
  });
  await expect(page.getByText('Loaded “clicks”')).toBeVisible();
  await page.getByRole('radio', { name: 'Chop' }).click();
  await page.getByRole('button', { name: 'Find hits' }).click();
  await expect(page.getByRole('button', { name: /^Play slice 4/ })).toBeVisible();
  await page.getByRole('button', { name: 'Slices to pattern' }).click();
  await page.reload();
  await page.getByText('Sampler', { exact: true }).first().click();
  await expect(page.getByRole('slider', { name: 'Trim start' })).toBeVisible();
});

test('performance mode launches sections and holds effects', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Performance mode', exact: true }).click();
  const perform = page.getByRole('dialog', { name: 'Performance mode' });
  await perform.getByRole('button', { name: /^2/ }).first().click();
  await expect(perform.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  const wash = perform.getByRole('button', { name: /Wash/ });
  await wash.dispatchEvent('pointerdown', { pointerId: 1 });
  await page.waitForTimeout(300);
  await wash.dispatchEvent('pointerup', { pointerId: 1 });
  await page.keyboard.press('Escape');
  await expect(perform).toBeHidden();
  await page.keyboard.press('Space');
});

test('exports a mastered MP3 and cover art', async ({ studio: page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /^Cover art/ }).click();
  const [cover] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Cover art' }).click(),
  ]);
  const png = await readFile((await cover.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
});

test('exports a music video', async ({ studio: page }) => {
  test.setTimeout(120_000);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /^Video/ }).click();
  await page.getByRole('radio', { name: 'Vinyl' }).click();
  await page.getByRole('radio', { name: '1:1' }).click();
  await page.getByRole('radio', { name: 'WebM' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 110_000 }),
    page.getByRole('button', { name: 'Export Video' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.webm$/);
  const bytes = await readFile((await download.path())!);
  // EBML magic number
  expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  expect(bytes.length).toBeGreaterThan(100_000);
});
