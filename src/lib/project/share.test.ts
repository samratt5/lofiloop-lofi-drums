import { describe, expect, it } from 'vitest';
import { createDemoProject } from './templates';
import { createShareUrl, decodeShareData, encodeShareData, readShareHash } from './share';

describe('share links', () => {
  it('round-trips a project through a compressed URL payload', async () => {
    const project = createDemoProject();
    const data = await encodeShareData(project);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(data.length).toBeLessThan(4000);
    const decoded = await decodeShareData(data);
    expect(decoded.tracks).toEqual(project.tracks);
    expect(decoded.patterns).toEqual(project.patterns);
    expect(decoded.fx).toEqual(project.fx);
  });

  it('builds and reads the hash', async () => {
    const url = await createShareUrl(createDemoProject(), 'https://lofiloop.app/?x=1#old');
    const parsed = new URL(url);
    expect(parsed.search).toBe('');
    expect(readShareHash(parsed.hash)).toBeTruthy();
    expect(readShareHash('#other=1')).toBeNull();
  });

  it('rejects corrupted payloads', async () => {
    await expect(decodeShareData('AAAA')).rejects.toBeTruthy();
  });
});
