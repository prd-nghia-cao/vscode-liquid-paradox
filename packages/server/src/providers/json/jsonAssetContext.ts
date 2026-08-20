import { findNodeAtOffset, getNodePath, parseTree } from 'jsonc-parser';
import type { AssetKind } from '../../workspace/assetIndex.js';

const IMAGE: ReadonlySet<AssetKind> = new Set<AssetKind>(['image']);
const VIDEO: ReadonlySet<AssetKind> = new Set<AssetKind>(['video']);
const AUDIO: ReadonlySet<AssetKind> = new Set<AssetKind>(['audio']);
const ANY: ReadonlySet<AssetKind> = new Set<AssetKind>(['image', 'video', 'audio']);

/**
 * Words that identify the media kind a `src` key holds. Matched against the
 * qualifier's own words, so `heroVideo` is a video and `videoThumbnail` — a
 * still *of* a video — is an image.
 */
const KIND_WORDS: Array<[ReadonlySet<AssetKind>, ReadonlySet<string>]> = [
  [VIDEO, new Set(['video', 'movie', 'clip', 'reel', 'trailer', 'footage'])],
  [AUDIO, new Set(['audio', 'sound', 'track', 'podcast', 'voiceover'])],
  [
    IMAGE,
    new Set([
      'image',
      'img',
      'thumbnail',
      'thumb',
      'photo',
      'picture',
      'pic',
      'icon',
      'logo',
      'poster',
      'avatar',
      'banner',
      'illustration',
      'graphic',
      'screenshot',
      'headshot',
      'artwork',
    ]),
  ],
];

export interface JsonAssetContext {
  kinds: ReadonlySet<AssetKind>;
  /** Dotted key path of the value, e.g. `roles[].image.src`. For logging. */
  keyPath: string;
  /** Offsets of the string's contents, excluding the quotes. */
  replaceStart: number;
  replaceEnd: number;
}

/** Splits `heroVideo`, `hero_video` and `HeroVideo` into lower-cased words. */
function words(qualifier: string): string[] {
  return qualifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function kindsForQualifier(qualifier: string): ReadonlySet<AssetKind> {
  // Later words qualify earlier ones, so the last recognized word wins.
  for (const word of words(qualifier).reverse()) {
    const singular = word.endsWith('s') ? word.slice(0, -1) : word;
    for (const [kinds, vocabulary] of KIND_WORDS) {
      if (vocabulary.has(word) || vocabulary.has(singular)) return kinds;
    }
  }
  // A `src` under an unrecognized key (`awards`, `hero`, `phoneApp`) is still a
  // media URL — offer every kind rather than nothing.
  return ANY;
}

/**
 * The asset kinds a JSON key path should offer, or `undefined` when the key is
 * not a media source at all.
 *
 * The leaf must be `src` or end in `Src` / `_src`. The kind comes from that
 * key's qualifier: the prefix when the leaf carries one (`videoSrc` → `video`,
 * `thumbnailSrc` → `thumbnail`), otherwise the nearest ancestor object key,
 * skipping array indices (`roles[].image.src` → `image`).
 */
export function mediaKindsForKeyPath(path: Array<string | number>): ReadonlySet<AssetKind> | undefined {
  const leaf = path[path.length - 1];
  if (typeof leaf !== 'string') return undefined;

  const leafMatch = leaf.match(/^(.*?)[_]?(?:src|Src|SRC)$/);
  if (!leafMatch) return undefined;

  let qualifier = leafMatch[1]!;
  if (!qualifier) {
    // Bare `src` — look outward for the owning key, past any array indices.
    for (let i = path.length - 2; i >= 0; i--) {
      const seg = path[i];
      if (typeof seg === 'string') {
        qualifier = seg;
        break;
      }
    }
  }
  return kindsForQualifier(qualifier);
}

function formatKeyPath(path: Array<string | number>): string {
  return path.map((s) => (typeof s === 'number' ? '[]' : s)).join('.');
}

/**
 * Resolves the asset context at `offset` in a `.liquid.json` sidecar. Returns
 * `undefined` unless the cursor is inside a string *value* whose key marks it as
 * a media source.
 *
 * Parsing is error-tolerant: mid-edit documents with an unterminated string or a
 * trailing comma still resolve, which is the normal state while typing.
 */
export function jsonAssetContextAt(text: string, offset: number): JsonAssetContext | undefined {
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (!root) return undefined;

  const node = findNodeAtOffset(root, offset, true);
  if (!node || node.type !== 'string') return undefined;

  // Reject property *names*: a property node's first child is its key.
  if (node.parent?.type === 'property' && node.parent.children?.[0] === node) return undefined;

  const kinds = mediaKindsForKeyPath(getNodePath(node));
  if (!kinds) return undefined;

  // `node.offset`/`node.length` span the quotes. An unterminated string has no
  // closing quote, so only trim one when it is actually present.
  const start = node.offset + 1;
  const last = node.offset + node.length - 1;
  const end = node.length > 1 && (text[last] === '"' || text[last] === "'") ? last : node.offset + node.length;
  if (offset < start || offset > end) return undefined;

  return { kinds, keyPath: formatKeyPath(getNodePath(node)), replaceStart: start, replaceEnd: Math.max(start, end) };
}
