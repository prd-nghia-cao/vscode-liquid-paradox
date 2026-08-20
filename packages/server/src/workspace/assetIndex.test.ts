import { describe, it, expect } from 'vitest';
import type { Dirent, PathLike } from 'node:fs';
import {
  applyAssetEvent,
  assetKindForPath,
  assetsOfKinds,
  assetUrl,
  buildAssetIndex,
  emptyAssetIndex,
  type AssetKind,
} from './assetIndex.js';

/** Minimal in-memory fs: maps directory path -> child names, and file -> size. */
function fakeFs(tree: Record<string, string[]>, sizes: Record<string, number> = {}) {
  const isDir = (p: string): boolean => Object.prototype.hasOwnProperty.call(tree, p);
  return {
    async readdir(p: PathLike, _opts: { withFileTypes: true }): Promise<Dirent[]> {
      const key = String(p);
      const children = tree[key];
      if (!children) throw new Error(`ENOENT: ${key}`);
      return children.map(
        (name) =>
          ({
            name,
            isDirectory: () => isDir(`${key}/${name}`),
            isFile: () => !isDir(`${key}/${name}`),
          }) as Dirent,
      );
    },
    async stat(p: PathLike): Promise<{ size: number }> {
      return { size: sizes[String(p)] ?? 0 };
    },
  };
}

describe('assetKindForPath', () => {
  it('classifies by extension, case-insensitively', () => {
    expect(assetKindForPath('a/hero.PNG')).toBe('image');
    expect(assetKindForPath('a/reel.mp4')).toBe('video');
    expect(assetKindForPath('a/theme.mp3')).toBe('audio');
  });

  it('returns undefined for non-media files', () => {
    expect(assetKindForPath('a/styles.css')).toBeUndefined();
    expect(assetKindForPath('a/data.json')).toBeUndefined();
    expect(assetKindForPath('a/README')).toBeUndefined();
  });
});

describe('assetUrl', () => {
  it('maps a path under the assets dir to its root-relative served URL', () => {
    expect(assetUrl('/r/src/assets', '/r/src/assets/hero.png')).toBe('/hero.png');
    expect(assetUrl('/r/src/assets', '/r/src/assets/img/team.webp')).toBe('/img/team.webp');
  });
});

describe('buildAssetIndex', () => {
  it('walks nested directories and records url, kind and size', async () => {
    const fs = fakeFs(
      {
        '/r/assets': ['hero.png', 'img', 'video'],
        '/r/assets/img': ['team.webp'],
        '/r/assets/video': ['reel.mp4'],
      },
      { '/r/assets/hero.png': 2048, '/r/assets/img/team.webp': 500, '/r/assets/video/reel.mp4': 3 * 1024 * 1024 },
    );
    const idx = await buildAssetIndex({ assetsDir: '/r/assets', fs });
    expect([...idx.assets.keys()].sort()).toEqual(['/hero.png', '/img/team.webp', '/video/reel.mp4']);
    expect(idx.assets.get('/img/team.webp')).toEqual({
      url: '/img/team.webp',
      absPath: '/r/assets/img/team.webp',
      kind: 'image',
      size: 500,
    });
  });

  it('skips non-media files and dotfiles', async () => {
    const fs = fakeFs({ '/r/assets': ['.DS_Store', '.gitkeep', 'notes.txt', 'ok.svg'] });
    const idx = await buildAssetIndex({ assetsDir: '/r/assets', fs });
    expect([...idx.assets.keys()]).toEqual(['/ok.svg']);
  });

  it('returns an empty index when the assets directory does not exist', async () => {
    const idx = await buildAssetIndex({ assetsDir: '/nope', fs: fakeFs({}) });
    expect(idx.assets.size).toBe(0);
  });
});

describe('applyAssetEvent', () => {
  const dir = '/r/assets';

  it('adds on create and removes on delete', () => {
    const idx = emptyAssetIndex();
    applyAssetEvent(idx, dir, '/r/assets/img/a.png', 'created', 10);
    expect(idx.assets.get('/img/a.png')?.kind).toBe('image');
    applyAssetEvent(idx, dir, '/r/assets/img/a.png', 'deleted', 0);
    expect(idx.assets.size).toBe(0);
  });

  it('ignores paths outside the assets dir, non-media files and dotfiles', () => {
    const idx = emptyAssetIndex();
    applyAssetEvent(idx, dir, '/r/src/components/button.liquid', 'created', 1);
    applyAssetEvent(idx, dir, '/r/assets/styles.css', 'created', 1);
    applyAssetEvent(idx, dir, '/r/assets/.DS_Store', 'created', 1);
    // A sibling directory sharing the prefix must not be treated as inside.
    applyAssetEvent(idx, '/r/asset', '/r/assets/hero.png', 'created', 1);
    expect(idx.assets.size).toBe(0);
  });
});

describe('assetsOfKinds', () => {
  it('filters by kind and sorts by url', () => {
    const idx = emptyAssetIndex();
    applyAssetEvent(idx, '/a', '/a/z.png', 'created', 1);
    applyAssetEvent(idx, '/a', '/a/b.png', 'created', 1);
    applyAssetEvent(idx, '/a', '/a/clip.mp4', 'created', 1);
    const images = assetsOfKinds(idx, new Set<AssetKind>(['image']));
    expect(images.map((a) => a.url)).toEqual(['/b.png', '/z.png']);
    const both = assetsOfKinds(idx, new Set<AssetKind>(['image', 'video']));
    expect(both.map((a) => a.url)).toEqual(['/b.png', '/clip.mp4', '/z.png']);
  });
});
