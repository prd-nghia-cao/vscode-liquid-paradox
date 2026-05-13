import { describe, it, expect } from 'vitest';
import { createServerState } from './serverState.js';

describe('createServerState', () => {
  it('returns disabled-paths state when vite config parse fails', () => {
    const state = createServerState({
      readVite: () => undefined,
      readFileSync: () => undefined,
      buildFileIndex: async () => ({ components: new Map(), partials: new Map(), layouts: new Map() }),
    });
    expect(state.pathFeaturesEnabled).toBe(false);
    expect(state.dirs).toBeUndefined();
  });

  it('parses and resolves dirs when vite config is valid', async () => {
    const state = createServerState({
      readVite: () => ({
        text: `pageDiscoveryPlugin({ pagesDir: 'p', layoutsDir: 'l', partialsDir: 'pa', componentsDir: 'c' });`,
        repoRoot: '/r',
      }),
      readFileSync: () => undefined,
      buildFileIndex: async () => ({ components: new Map(), partials: new Map(), layouts: new Map() }),
    });
    await state.refreshConfig();
    expect(state.pathFeaturesEnabled).toBe(true);
    expect(state.dirs?.componentsDir).toBe('/r/c');
  });

  it('caches component props by absolute path, invalidates on demand', async () => {
    const state = createServerState({
      readVite: () => ({
        text: `pageDiscoveryPlugin({ pagesDir: 'p', layoutsDir: 'l', partialsDir: 'pa', componentsDir: 'c' });`,
        repoRoot: '/r',
      }),
      readFileSync: (p) => (p === '/r/c/button.liquid' ? `{% assign type = type | default: 'p' %}` : undefined),
      buildFileIndex: async () => ({
        components: new Map([['button', { absPath: '/r/c/button.liquid', mtime: 1 }]]),
        partials: new Map(),
        layouts: new Map(),
      }),
    });
    await state.refreshConfig();
    const first = state.lookupComponentProps('button');
    expect(first?.[0].name).toBe('type');
    state.invalidateComponentProps('button');
    const again = state.lookupComponentProps('button');
    expect(again?.[0].name).toBe('type');
  });
});
