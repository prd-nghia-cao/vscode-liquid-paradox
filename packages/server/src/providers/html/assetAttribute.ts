import { TokenType, type HTMLDocument } from 'vscode-html-languageservice';
import { getHtmlService } from './htmlService.js';
import type { AssetKind } from '../../workspace/assetIndex.js';

const IMAGE: ReadonlySet<AssetKind> = new Set<AssetKind>(['image']);
const VIDEO: ReadonlySet<AssetKind> = new Set<AssetKind>(['video']);
/** `<audio>` accepts container formats that also carry video (`.mp4`, `.webm`). */
const AUDIO: ReadonlySet<AssetKind> = new Set<AssetKind>(['audio', 'video']);
const ANY: ReadonlySet<AssetKind> = new Set<AssetKind>(['image', 'video', 'audio']);

export interface AssetAttributeContext {
  /** Asset kinds appropriate for this element/attribute pair. */
  kinds: ReadonlySet<AssetKind>;
  /** Lower-cased tag name the cursor's attribute belongs to. */
  tag: string;
  /** Lower-cased attribute name. */
  attribute: string;
  /**
   * Offsets of the single URL token to replace. For `srcset` this is the
   * candidate's URL word only, so existing `, 2x` descriptors survive.
   */
  replaceStart: number;
  replaceEnd: number;
}

/**
 * Resolves the asset kinds that belong in a given element/attribute pair.
 * `<source>` takes its kinds from the parent element, since a `<source>` inside
 * `<picture>` is an image and one inside `<video>` is not.
 */
function kindsFor(tag: string, attribute: string, parentTag: string | undefined): ReadonlySet<AssetKind> | undefined {
  if (attribute === 'poster') return IMAGE;

  if (tag === 'img') {
    return attribute === 'src' || attribute === 'srcset' ? IMAGE : undefined;
  }
  if (tag === 'video') return attribute === 'src' ? VIDEO : undefined;
  if (tag === 'audio') return attribute === 'src' ? AUDIO : undefined;
  if (tag === 'source') {
    if (attribute !== 'src' && attribute !== 'srcset') return undefined;
    if (parentTag === 'picture') return IMAGE;
    if (parentTag === 'video') return VIDEO;
    if (parentTag === 'audio') return AUDIO;
    // A `<source>` with no recognized media parent — offer everything rather
    // than nothing, since the intent is still a media URL.
    return ANY;
  }
  return undefined;
}

/**
 * Detects whether `offset` sits inside an attribute value that should offer
 * assets from `src/assets/`, and returns the token range to replace.
 *
 * `text` must be the masked virtual HTML document (offset-parity with the
 * source), so Liquid inside markup cannot be mistaken for attribute syntax.
 */
export function assetAttributeAt(
  text: string,
  htmlDoc: HTMLDocument,
  offset: number,
): AssetAttributeContext | undefined {
  const node = htmlDoc.findNodeAt(offset);
  if (!node.tag) return undefined;

  const found = attributeValueAt(text, node.start, offset);
  if (!found) return undefined;

  const tag = node.tag.toLowerCase();
  const kinds = kindsFor(tag, found.attribute, node.parent?.tag?.toLowerCase());
  if (!kinds) return undefined;

  const { start, end } = urlTokenAround(text, found.valueStart, found.valueEnd, offset);
  return { kinds, tag, attribute: found.attribute, replaceStart: start, replaceEnd: end };
}

interface AttributeValueHit {
  attribute: string;
  /** Inner value offsets, excluding any surrounding quotes. */
  valueStart: number;
  valueEnd: number;
}

/**
 * Scans the start tag beginning at `tagStart` and reports the attribute whose
 * value contains `offset`. Returns `undefined` when the cursor is on the tag
 * name, an attribute name, or outside any value.
 */
function attributeValueAt(text: string, tagStart: number, offset: number): AttributeValueHit | undefined {
  const scanner = getHtmlService().createScanner(text, tagStart);
  let attribute: string | undefined;

  for (let token = scanner.scan(); token !== TokenType.EOS; token = scanner.scan()) {
    const start = scanner.getTokenOffset();
    const end = start + scanner.getTokenLength();
    if (start > offset) return undefined;

    if (token === TokenType.AttributeName) {
      attribute = scanner.getTokenText().toLowerCase();
      continue;
    }
    if (token !== TokenType.AttributeValue) continue;
    // The cursor may sit at `end` (immediately before the closing quote of an
    // empty `src=""`, which the scanner reports as a 2-char token).
    if (offset < start || offset > end) continue;
    if (!attribute) return undefined;

    // Narrow to the inner value. The closing quote is only trimmed when it is
    // actually there — a half-typed `src="/hero` is reported as one token whose
    // last character is part of the value.
    const quote = text[start];
    const quoted = quote === '"' || quote === "'";
    const valueStart = quoted ? start + 1 : start;
    const valueEnd = quoted && end - 1 >= valueStart && text[end - 1] === quote ? end - 1 : end;
    if (offset < valueStart || offset > valueEnd) return undefined;
    return { attribute, valueStart, valueEnd };
  }
  return undefined;
}

/**
 * The URL word surrounding `offset` inside an attribute value. `srcset` holds a
 * comma-separated candidate list where each candidate is `<url> <descriptor>`,
 * so word boundaries are commas and whitespace; for `src`/`poster` that is the
 * whole value.
 */
function urlTokenAround(
  text: string,
  valueStart: number,
  valueEnd: number,
  offset: number,
): { start: number; end: number } {
  const isBoundary = (i: number): boolean => /[,\s]/.test(text[i]!);
  let start = offset;
  while (start > valueStart && !isBoundary(start - 1)) start--;
  let end = offset;
  while (end < valueEnd && !isBoundary(end)) end++;
  return { start, end };
}
