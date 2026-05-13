import { describe, it, expect, beforeEach } from 'vitest';
import { fs, vol } from 'memfs';
import { buildFileIndex, applyFileEvent } from './fileIndex.js';

beforeEach(() => vol.reset());

describe('buildFileIndex', () => {
  it('indexes components, partials, and layouts; strips .liquid; key is dir-relative', () => {
    vol.fromJSON({
      '/r/c/button.liquid': '',
      '/r/c/forms/input.liquid': '',
      '/r/p/layout/header.liquid': '',
      '/r/l/main.liquid': '',
      '/r/l/special/job.liquid': '',
    });
    const idx = buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/r/p',
      layoutsDir: '/r/l',
      pagesDir: '/r/pages',
      fs: fs.promises as never,
    });
    return idx.then((i) => {
      expect([...i.components.keys()].sort()).toEqual(['button', 'forms/input']);
      expect([...i.partials.keys()].sort()).toEqual(['layout/header']);
      expect([...i.layouts.keys()].sort()).toEqual(['main', 'special/job']);
      expect(i.components.get('button')?.absPath).toBe('/r/c/button.liquid');
    });
  });

  it('ignores .liquid.json sidecars while indexing', async () => {
    vol.fromJSON({
      '/r/c/x.liquid': '',
      '/r/c/x.liquid.json': '{}',
    });
    const i = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/r/p',
      layoutsDir: '/r/l',
      pagesDir: '/r/p',
      fs: fs.promises as never,
    });
    expect([...i.components.keys()]).toEqual(['x']);
  });

  it('handles a missing dir gracefully (empty map, no throw)', async () => {
    vol.fromJSON({ '/r/c/x.liquid': '' });
    const i = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/missing',
      layoutsDir: '/also-missing',
      pagesDir: '/r/p',
      fs: fs.promises as never,
    });
    expect(i.components.size).toBe(1);
    expect(i.partials.size).toBe(0);
    expect(i.layouts.size).toBe(0);
  });
});

describe('applyFileEvent', () => {
  it('adds a file on create event', async () => {
    vol.fromJSON({ '/r/c/a.liquid': '' });
    const idx = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/x',
      layoutsDir: '/y',
      pagesDir: '/z',
      fs: fs.promises as never,
    });
    applyFileEvent(idx, { componentsDir: '/r/c', partialsDir: '/x', layoutsDir: '/y' }, '/r/c/b.liquid', 'created', 42);
    expect(idx.components.get('b')?.mtime).toBe(42);
  });

  it('removes a file on delete event', async () => {
    vol.fromJSON({ '/r/c/a.liquid': '' });
    const idx = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/x',
      layoutsDir: '/y',
      pagesDir: '/z',
      fs: fs.promises as never,
    });
    applyFileEvent(idx, { componentsDir: '/r/c', partialsDir: '/x', layoutsDir: '/y' }, '/r/c/a.liquid', 'deleted', 0);
    expect(idx.components.has('a')).toBe(false);
  });

  it('classifies the path into the right map by directory prefix', async () => {
    const idx = {
      components: new Map(),
      partials: new Map(),
      layouts: new Map(),
    };
    applyFileEvent(idx, { componentsDir: '/c', partialsDir: '/p', layoutsDir: '/l' }, '/p/footer.liquid', 'created', 1);
    expect(idx.partials.has('footer')).toBe(true);
    expect(idx.components.has('footer')).toBe(false);
  });
});
