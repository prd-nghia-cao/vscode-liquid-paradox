import { describe, it, expect } from 'vitest';
import { buildWatcherRegistrations, routeFileEvent } from './watchers.js';
import { createDepGraph } from './depGraph.js';
import type { FileIndex } from './fileIndex.js';

describe('buildWatcherRegistrations', () => {
  it('returns watchers covering vite.config.ts, *.liquid in indexed dirs, *.liquid.json in pages+partials, and the assets tree', () => {
    const regs = buildWatcherRegistrations({
      pagesDir: '/r/pages',
      partialsDir: '/r/partials',
      componentsDir: '/r/components',
      layoutsDir: '/r/layouts',
      assetsDir: '/r/assets',
    });
    expect(regs).toHaveLength(4);
    expect(regs[0].globPattern).toMatch(/vite\.config\.ts$/);
    expect(regs[1].globPattern).toContain('.liquid');
    expect(regs[2].globPattern).toContain('.liquid.json');
    expect(regs[3]!.globPattern).toBe('/r/assets/**/*');
  });
});

describe('routeFileEvent', () => {
  it('vite.config.ts change → rebuildIndex flag', () => {
    const out = routeFileEvent({
      absPath: '/r/vite.config.ts',
      event: 'changed',
      mtime: 5,
      dirs: {
        repoRoot: '/r',
        pagesDir: '/r/p',
        partialsDir: '/r/pa',
        componentsDir: '/r/c',
        layoutsDir: '/r/l',
        assetsDir: '/r/a',
      },
      fileIndex: { components: new Map(), partials: new Map(), layouts: new Map() } as FileIndex,
      depGraph: createDepGraph(),
      openUris: [],
    });
    expect(out.rebuildIndex).toBe(true);
    expect(out.urisToRediagnose).toEqual([]);
  });

  it('media file under assetsDir → assetEvent for the caller to apply', () => {
    const base = {
      event: 'created' as const,
      mtime: 5,
      dirs: {
        repoRoot: '/r',
        pagesDir: '/r/p',
        partialsDir: '/r/pa',
        componentsDir: '/r/c',
        layoutsDir: '/r/l',
        assetsDir: '/r/a',
      },
      fileIndex: { components: new Map(), partials: new Map(), layouts: new Map() } as FileIndex,
      depGraph: createDepGraph(),
      openUris: [],
    };
    expect(routeFileEvent({ ...base, absPath: '/r/a/img/hero.png' }).assetEvent).toEqual({
      absPath: '/r/a/img/hero.png',
      event: 'created',
    });
    // Non-media files in the assets tree, and media outside it, are ignored.
    expect(routeFileEvent({ ...base, absPath: '/r/a/styles.css' }).assetEvent).toBeUndefined();
    expect(routeFileEvent({ ...base, absPath: '/r/other/hero.png' }).assetEvent).toBeUndefined();
  });

  it('component .liquid change → updates index map and returns dependents from depGraph', () => {
    const idx: FileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
    const g = createDepGraph();
    g.set('file:///p/home.liquid', { renderedFiles: ['button'], layoutFile: undefined });
    const out = routeFileEvent({
      absPath: '/r/c/button.liquid',
      event: 'created',
      mtime: 9,
      dirs: {
        repoRoot: '/r',
        pagesDir: '/r/p',
        partialsDir: '/r/pa',
        componentsDir: '/r/c',
        layoutsDir: '/r/l',
        assetsDir: '/r/a',
      },
      fileIndex: idx,
      depGraph: g,
      openUris: ['file:///p/home.liquid'],
    });
    expect(idx.components.get('button')?.absPath).toBe('/r/c/button.liquid');
    expect(out.urisToRediagnose).toEqual(['file:///p/home.liquid']);
    expect(out.invalidateComponentPropsKey).toBe('button');
  });

  it('.liquid.json change → returns dependents from depGraph by jsonCompanion path', () => {
    const g = createDepGraph();
    g.set('file:///p/home.liquid', {
      jsonCompanion: '/r/p/home.liquid.json',
      renderedFiles: [],
      layoutFile: undefined,
    });
    const out = routeFileEvent({
      absPath: '/r/p/home.liquid.json',
      event: 'changed',
      mtime: 1,
      dirs: {
        repoRoot: '/r',
        pagesDir: '/r/p',
        partialsDir: '/r/pa',
        componentsDir: '/r/c',
        layoutsDir: '/r/l',
        assetsDir: '/r/a',
      },
      fileIndex: { components: new Map(), partials: new Map(), layouts: new Map() } as FileIndex,
      depGraph: g,
      openUris: ['file:///p/home.liquid'],
    });
    expect(out.urisToRediagnose).toEqual(['file:///p/home.liquid']);
    expect(out.invalidateJsonPath).toBe('/r/p/home.liquid.json');
  });
});
