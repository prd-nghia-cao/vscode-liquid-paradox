import { describe, it, expect } from 'vitest';
import { jsonAssetContextAt, mediaKindsForKeyPath } from './jsonAssetContext.js';

const kinds = (path: Array<string | number>): string[] | undefined => {
  const set = mediaKindsForKeyPath(path);
  return set && [...set].sort();
};

/** Locates the cursor from a `|` marker and returns the context at it. */
function contextAt(marked: string) {
  const offset = marked.indexOf('|');
  expect(offset, 'test input needs a | cursor marker').toBeGreaterThan(-1);
  return jsonAssetContextAt(marked.slice(0, offset) + marked.slice(offset + 1), offset);
}

describe('mediaKindsForKeyPath', () => {
  it('reads the kind from the qualifier on the leaf key', () => {
    expect(kinds(['thumbnailSrc'])).toEqual(['image']);
    expect(kinds(['videoSrc'])).toEqual(['video']);
    expect(kinds(['heroImageSrc'])).toEqual(['image']);
    expect(kinds(['backgroundVideoSrc'])).toEqual(['video']);
  });

  it('reads the kind from the owning key of a bare src', () => {
    expect(kinds(['thumbnail', 'src'])).toEqual(['image']);
    expect(kinds(['image', 'src'])).toEqual(['image']);
    expect(kinds(['heroImage', 'src'])).toEqual(['image']);
    expect(kinds(['heroImg', 'src'])).toEqual(['image']);
    expect(kinds(['video', 'src'])).toEqual(['video']);
    expect(kinds(['heroVideo', 'src'])).toEqual(['video']);
  });

  it('skips array indices when looking for the owning key', () => {
    expect(kinds(['roles', 0, 'image', 'src'])).toEqual(['image']);
    expect(kinds(['clips', 3, 'src'])).toEqual(['video']);
  });

  it('treats a plural owning key as its singular', () => {
    expect(kinds(['images', 'src'])).toEqual(['image']);
  });

  it('lets the last word qualify the earlier ones', () => {
    // A thumbnail *of* a video is still an image.
    expect(kinds(['videoThumbnailSrc'])).toEqual(['image']);
    expect(kinds(['video', 'thumbnail', 'src'])).toEqual(['image']);
  });

  it('accepts snake_case keys', () => {
    expect(kinds(['hero_image_src'])).toEqual(['image']);
    expect(kinds(['hero_video', 'src'])).toEqual(['video']);
  });

  it('offers every kind when the qualifier says nothing', () => {
    // Real sidecar shapes: `awards[].src`, `phoneApp.src`, `hero.src`.
    expect(kinds(['awards', 0, 'src'])).toEqual(['audio', 'image', 'video']);
    expect(kinds(['phoneApp', 'src'])).toEqual(['audio', 'image', 'video']);
    expect(kinds(['src'])).toEqual(['audio', 'image', 'video']);
  });

  it('rejects keys that are not a media source', () => {
    expect(kinds(['image', 'alt'])).toBeUndefined();
    expect(kinds(['title'])).toBeUndefined();
    // Vimeo/YouTube page links, not files under src/assets.
    expect(kinds(['videoUrl'])).toBeUndefined();
    expect(kinds(['sources'])).toBeUndefined();
    expect(kinds([0])).toBeUndefined();
  });
});

describe('jsonAssetContextAt', () => {
  it('resolves an empty string value and reports the key path', () => {
    const ctx = contextAt('{"image": {"src": "|"}}');
    expect(ctx?.keyPath).toBe('image.src');
    expect([...ctx!.kinds]).toEqual(['image']);
  });

  it('replaces the whole existing value', () => {
    const text = '{"video": {"src": "/reel.mp4"}}';
    const ctx = jsonAssetContextAt(text, text.indexOf('/reel.mp4') + 3);
    expect(ctx).toBeDefined();
    expect(text.slice(ctx!.replaceStart, ctx!.replaceEnd)).toBe('/reel.mp4');
    expect([...ctx!.kinds]).toEqual(['video']);
  });

  it('resolves values nested under array items', () => {
    const ctx = contextAt('{"roles": [{"title": "x", "image": {"src": "/a|.webp"}}]}');
    expect(ctx?.keyPath).toBe('roles.[].image.src');
    expect([...ctx!.kinds]).toEqual(['image']);
  });

  it('tolerates an unterminated string mid-typing', () => {
    const text = '{"image": {"src": "/he';
    const ctx = jsonAssetContextAt(text, text.length);
    expect(ctx?.replaceStart).toBe(text.indexOf('/he'));
    expect(ctx?.replaceEnd).toBe(text.length);
  });

  it('tolerates a trailing comma', () => {
    const ctx = contextAt('{"thumbnailSrc": "|", }');
    expect([...ctx!.kinds]).toEqual(['image']);
  });

  it('ignores the property name itself', () => {
    expect(contextAt('{"image": {"sr|c": ""}}')).toBeUndefined();
  });

  it('ignores values under non-media keys', () => {
    expect(contextAt('{"image": {"alt": "|"}}')).toBeUndefined();
    expect(contextAt('{"videoUrl": "|"}')).toBeUndefined();
  });

  it('ignores non-string values and positions outside any string', () => {
    expect(contextAt('{"image": {"src": 1|2}}')).toBeUndefined();
    expect(contextAt('{"image": |{"src": ""}}')).toBeUndefined();
  });

  it('returns nothing for an empty document', () => {
    expect(jsonAssetContextAt('', 0)).toBeUndefined();
    expect(jsonAssetContextAt('   ', 2)).toBeUndefined();
  });
});
