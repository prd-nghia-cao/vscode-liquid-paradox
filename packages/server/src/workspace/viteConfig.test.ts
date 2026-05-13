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

  it('returns ok=false when a required path option is missing', () => {
    const r = parseViteConfig(`pageDiscoveryPlugin({ pagesDir: 'p' });`, '/r');
    expect(r.ok).toBe(false);
  });

  it('returns ok=false when a path is a non-string literal', () => {
    const r = parseViteConfig(
      `pageDiscoveryPlugin({ pagesDir: 1, layoutsDir: 'l', partialsDir: 'p', componentsDir: 'c' });`,
      '/r',
    );
    expect(r.ok).toBe(false);
  });

  it('returns ok=false on syntactically invalid input', () => {
    const r = parseViteConfig(`this is not typescript {`, '/r');
    expect(r.ok).toBe(false);
  });
});
