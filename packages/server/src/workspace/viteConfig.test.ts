import { describe, it, expect } from 'vitest';
import { parseViteConfig } from './viteConfig.js';

describe('parseViteConfig', () => {
  it('extracts the four pageDiscoveryPlugin paths', () => {
    const src = `
      import { pageDiscoveryPlugin } from './plugins';
      export default {
        plugins: [
          pageDiscoveryPlugin({
            pagesDir: 'src/pages',
            layoutsDir: 'src/layouts',
            partialsDir: 'src/partials',
            componentsDir: 'src/components',
          })
        ]
      };
    `;
    const r = parseViteConfig(src, '/abs/repo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paths).toEqual({
        pagesDir: '/abs/repo/src/pages',
        layoutsDir: '/abs/repo/src/layouts',
        partialsDir: '/abs/repo/src/partials',
        componentsDir: '/abs/repo/src/components',
        assetsDir: '/abs/repo/src/assets',
      });
    }
  });

  it('handles double-quoted strings and trailing commas', () => {
    const src = `
      pageDiscoveryPlugin({
        pagesDir: "p",
        layoutsDir: "l",
        partialsDir: "pa",
        componentsDir: "c",
      });
    `;
    const r = parseViteConfig(src, '/r');
    expect(r.ok).toBe(true);
  });

  it('returns ok=false when no pageDiscoveryPlugin call is present', () => {
    const r = parseViteConfig(`export default {};`, '/r');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/pageDiscoveryPlugin/);
  });

  it('derives omitted path options from the declared ones by convention', () => {
    const r = parseViteConfig(`pageDiscoveryPlugin({ pagesDir: 'src/pages' });`, '/r');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paths).toEqual({
        pagesDir: '/r/src/pages',
        layoutsDir: '/r/src/layouts',
        partialsDir: '/r/src/partials',
        componentsDir: '/r/src/components',
        assetsDir: '/r/src/assets',
      });
    }
  });

  it('keeps explicitly declared paths when deriving the rest', () => {
    const r = parseViteConfig(
      `pageDiscoveryPlugin({ pagesDir: 'src/pages', partialsDir: 'src/shared/partials' });`,
      '/r',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paths.partialsDir).toBe('/r/src/shared/partials');
      expect(r.paths.componentsDir).toBe('/r/src/components');
    }
  });

  it('returns ok=false when no path option at all is declared', () => {
    const r = parseViteConfig(`pageDiscoveryPlugin({ patterns: ['**/*.liquid'] });`, '/r');
    expect(r.ok).toBe(false);
  });

  it('returns ok=false when a path is a non-string literal', () => {
    const r = parseViteConfig(
      `pageDiscoveryPlugin({ pagesDir: 1, layoutsDir: 'l', partialsDir: 'p', componentsDir: 'c' });`,
      '/r',
    );
    expect(r.ok).toBe(false);
  });

  it('reads assetsDir from staticAssetsPlugin()', () => {
    const src = `
      pageDiscoveryPlugin({ pagesDir: 'src/pages' });
      staticAssetsPlugin({ assetsDir: 'public/media' });
    `;
    const r = parseViteConfig(src, '/r');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paths.assetsDir).toBe('/r/public/media');
  });

  it('falls back to <srcRoot>/assets when staticAssetsPlugin is absent or omits assetsDir', () => {
    const absent = parseViteConfig(`pageDiscoveryPlugin({ pagesDir: 'src/pages' });`, '/r');
    expect(absent.ok && absent.paths.assetsDir).toBe('/r/src/assets');

    const omitted = parseViteConfig(
      `pageDiscoveryPlugin({ pagesDir: 'src/pages' }); staticAssetsPlugin({ outputDir: 'media' });`,
      '/r',
    );
    expect(omitted.ok && omitted.paths.assetsDir).toBe('/r/src/assets');
  });

  it('returns ok=false on syntactically invalid input', () => {
    const r = parseViteConfig(`this is not typescript {`, '/r');
    expect(r.ok).toBe(false);
  });
});
