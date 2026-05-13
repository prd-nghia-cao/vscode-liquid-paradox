import { describe, it, expect, beforeEach } from 'vitest';
import { createDocumentStore } from './documentStore.js';

describe('DocumentStore', () => {
  let lookups: { isComponent: boolean; readJson: (p: string) => string | undefined };
  beforeEach(() => {
    lookups = {
      isComponent: false,
      readJson: () => undefined,
    };
  });

  it('caches DocumentModel by URI', () => {
    const store = createDocumentStore({
      isComponentUri: () => lookups.isComponent,
      readJsonCompanion: (path) => lookups.readJson(path),
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///x/home.liquid', '<h1>hi</h1>');
    expect(store.get('file:///x/home.liquid')?.text).toBe('<h1>hi</h1>');
  });

  it('passes the right jsonCompanion based on the URI', () => {
    lookups.readJson = (p) => (p === '/x/home.liquid.json' ? '{"title":"Hi"}' : undefined);
    const store = createDocumentStore({
      isComponentUri: () => lookups.isComponent,
      readJsonCompanion: (p) => lookups.readJson(p),
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///x/home.liquid', '{{ title }}');
    const m = store.get('file:///x/home.liquid')!;
    expect(m.scopeByOffset(5).get('title')?.type).toEqual({ kind: 'string' });
    expect(m.dependencies.jsonCompanion).toBe('/x/home.liquid.json');
  });

  it('flags isComponent on update', () => {
    lookups.isComponent = true;
    const store = createDocumentStore({
      isComponentUri: () => lookups.isComponent,
      readJsonCompanion: () => undefined,
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///c/button.liquid', `{% assign x = x | default: '' %}{{ x }}`);
    expect(store.get('file:///c/button.liquid')?.componentProps?.[0].name).toBe('x');
  });

  it('remove drops the cache entry', () => {
    const store = createDocumentStore({
      isComponentUri: () => false,
      readJsonCompanion: () => undefined,
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///a.liquid', 'x');
    store.remove('file:///a.liquid');
    expect(store.get('file:///a.liquid')).toBeUndefined();
  });

  it('update returns a fresh model when the text changes between calls', () => {
    const store = createDocumentStore({
      isComponentUri: () => false,
      readJsonCompanion: () => undefined,
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    const first = store.update('file:///a.liquid', '');
    const second = store.update('file:///a.liquid', '{%');
    expect(first.text).toBe('');
    expect(second.text).toBe('{%');
    expect(second).not.toBe(first);
  });

  it('update is idempotent when text is unchanged (reuses the cached model)', () => {
    const store = createDocumentStore({
      isComponentUri: () => false,
      readJsonCompanion: () => undefined,
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    const first = store.update('file:///a.liquid', '<h1>hi</h1>');
    const second = store.update('file:///a.liquid', '<h1>hi</h1>');
    expect(second).toBe(first);
  });
});
