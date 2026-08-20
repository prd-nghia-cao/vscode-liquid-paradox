import { describe, it, expect } from 'vitest';
import { getHtmlContext, isInHtmlRegion } from './htmlService.js';
import { assetAttributeAt, type AssetAttributeContext } from './assetAttribute.js';
import type { AssetKind } from '../../workspace/assetIndex.js';

let version = 0;

/**
 * Resolves the asset context at `|` in `markup`. The document is built through
 * `getHtmlContext`, so the same Liquid masking the server uses applies here.
 */
function at(markup: string): (AssetAttributeContext & { replaced: string }) | undefined {
  const offset = markup.indexOf('|');
  const text = markup.replace('|', '');
  const ctx = getHtmlContext(`file:///t${++version}.liquid`, version, text);
  const found = assetAttributeAt(ctx.virtualDoc.getText(), ctx.htmlDoc, offset);
  if (!found) return undefined;
  return { ...found, replaced: text.slice(found.replaceStart, found.replaceEnd) };
}

const kinds = (markup: string): AssetKind[] | undefined => {
  const c = at(markup);
  return c && [...c.kinds].sort();
};

describe('assetAttributeAt — which element/attribute pairs offer assets', () => {
  it('offers images for img src and srcset', () => {
    expect(kinds('<img src="|">')).toEqual(['image']);
    expect(kinds('<img srcset="|">')).toEqual(['image']);
  });

  it('offers images for poster', () => {
    expect(kinds('<video poster="|"></video>')).toEqual(['image']);
  });

  it('offers videos for video src', () => {
    expect(kinds('<video src="|"></video>')).toEqual(['video']);
  });

  it('takes source kinds from the parent element', () => {
    expect(kinds('<picture><source srcset="|"></picture>')).toEqual(['image']);
    expect(kinds('<video><source src="|"></video>')).toEqual(['video']);
    expect(kinds('<audio><source src="|"></audio>')).toEqual(['audio', 'video']);
  });

  it('offers every kind for a source with no media parent', () => {
    expect(kinds('<div><source src="|"></div>')).toEqual(['audio', 'image', 'video']);
  });

  it('offers audio and video containers for audio src', () => {
    expect(kinds('<audio src="|"></audio>')).toEqual(['audio', 'video']);
  });

  it('stays silent for unrelated attributes and elements', () => {
    expect(at('<img alt="|">')).toBeUndefined();
    expect(at('<script src="|"></script>')).toBeUndefined();
    expect(at('<a href="|"></a>')).toBeUndefined();
    expect(at('<iframe src="|"></iframe>')).toBeUndefined();
  });

  it('stays silent outside attribute values', () => {
    expect(at('<im|g src="">')).toBeUndefined();
    expect(at('<img sr|c="">')).toBeUndefined();
    expect(at('<img src=""> |text')).toBeUndefined();
  });
});

describe('assetAttributeAt — replace range', () => {
  it('spans the whole value for src', () => {
    const c = at('<img src="/old/hero.png|">');
    expect(c?.replaced).toBe('/old/hero.png');
  });

  it('is empty for an empty value', () => {
    const c = at('<img src="|">');
    expect(c?.replaced).toBe('');
    expect(c?.replaceStart).toBe(c?.replaceEnd);
  });

  it('covers a partially typed prefix regardless of cursor position within it', () => {
    expect(at('<img src="/img/he|">')?.replaced).toBe('/img/he');
    expect(at('<img src="/i|mg/hero.png">')?.replaced).toBe('/img/hero.png');
  });

  it('covers only the current candidate URL in a srcset list', () => {
    const c = at('<img srcset="/a.png 1x, /b|.png 2x">');
    expect(c?.replaced).toBe('/b.png');
  });

  it('is empty after a srcset comma, so the descriptor before it survives', () => {
    const c = at('<img srcset="/a.png 1x, |">');
    expect(c?.replaced).toBe('');
  });

  it('handles single-quoted and unquoted values', () => {
    expect(at("<img src='/hero.png|'>")?.replaced).toBe('/hero.png');
    expect(at('<img src=/hero.png|>')?.replaced).toBe('/hero.png');
  });
});

describe('assetAttributeAt — Liquid interaction', () => {
  it('offers assets in an attribute value that follows Liquid in the same tag', () => {
    expect(kinds('<img class="{{ cls }}" src="|">')).toEqual(['image']);
  });

  it('is gated out inside a Liquid expression in an asset attribute', () => {
    // `{{ … }}` is masked to whitespace, so the scanner sees an empty value and
    // `assetAttributeAt` alone would happily offer assets. The Liquid-span check
    // in `isInHtmlRegion` is what keeps the server from calling it here, so that
    // is what this asserts — the same gate `onCompletion` applies.
    const markup = '<img src="{{ hero }}">';
    const offset = '<img src="{{ '.length;
    const ctx = getHtmlContext('file:///liquid-attr.liquid', ++version, markup);
    expect(isInHtmlRegion(markup, offset, ctx.spans)).toBe(false);
  });
});
