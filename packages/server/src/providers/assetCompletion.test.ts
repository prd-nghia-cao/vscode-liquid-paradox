import { describe, it, expect } from 'vitest';
import { applyAssetEvent, emptyAssetIndex, type AssetKind } from '../workspace/assetIndex.js';
import { assetCompletions, type AssetTarget } from './assetCompletion.js';

function index(...files: string[]) {
  const idx = emptyAssetIndex();
  for (const f of files) applyAssetEvent(idx, '/a', `/a${f}`, 'created', 1536);
  return idx;
}

const ctx = (kinds: AssetKind[], replaceStart = 10, replaceEnd = 10): AssetTarget => ({
  kinds: new Set(kinds),
  replaceStart,
  replaceEnd,
});

const positionAt = (offset: number) => ({ line: 0, character: offset });

describe('assetCompletions', () => {
  it('offers one item per matching asset, labelled with the served URL', () => {
    const items = assetCompletions(index('/hero.png', '/img/team.webp', '/reel.mp4'), ctx(['image']), positionAt);
    expect(items.map((i) => i.label)).toEqual(['/hero.png', '/img/team.webp']);
  });

  it('replaces the URL token under the cursor rather than inserting at it', () => {
    const items = assetCompletions(index('/hero.png'), ctx(['image'], 10, 17), positionAt);
    expect(items[0]!.textEdit).toEqual({
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 17 } },
      newText: '/hero.png',
    });
  });

  it('reports kind and a human-readable size as detail', () => {
    const items = assetCompletions(index('/hero.png'), ctx(['image']), positionAt);
    expect(items[0]!.detail).toBe('image · 1.5 KB');
  });

  it('sorts with a numeric sortText so the editor keeps URL order', () => {
    const items = assetCompletions(index('/b.png', '/a.png'), ctx(['image']), positionAt);
    expect(items.map((i) => i.label)).toEqual(['/a.png', '/b.png']);
    expect(items.map((i) => i.sortText)).toEqual(['00000', '00001']);
  });

  it('returns nothing when no asset matches the requested kinds', () => {
    expect(assetCompletions(index('/hero.png'), ctx(['video']), positionAt)).toEqual([]);
    expect(assetCompletions(emptyAssetIndex(), ctx(['image']), positionAt)).toEqual([]);
  });
});
