import { isParadoxKind } from '../data/paradoxTags.js';

export type CursorRegion =
  | 'tag'
  | 'output'
  | 'paradox-intent'
  | 'paradox-value-typing'
  | 'paradox-confirmed'
  | 'output-after-pipe'
  | 'tag-after-pipe'
  | 'string-render-path'
  | 'string-layout-path'
  | 'string-include-path'
  | 'render-args'
  | 'text';

export interface CursorBucket {
  region: CursorRegion;
  openOffset: number;
  body: string;
  tagName?: string;
  paradoxKind?: string;
  renderTarget?: string;
  filterPartial?: string;
}

interface DelimiterHit {
  kind: 'tag-open' | 'output-open' | 'tag-close' | 'output-close';
  offset: number;
  length: number;
}

function scanBackForOpener(text: string, startOffset: number): DelimiterHit | null {
  let i = startOffset;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '{') {
      const two = text.slice(i, i + 2);
      const three = text.slice(i, i + 3);
      if (three === '{%-') return { kind: 'tag-open', offset: i, length: 3 };
      if (three === '{{-') return { kind: 'output-open', offset: i, length: 3 };
      if (two === '{%') return { kind: 'tag-open', offset: i, length: 2 };
      if (two === '{{') return { kind: 'output-open', offset: i, length: 2 };
    } else if (ch === '%' || ch === '}') {
      const two = text.slice(i, i + 2);
      const three = text.slice(i, i + 3);
      if (three === '-%}') return { kind: 'tag-close', offset: i, length: 3 };
      if (three === '-}}') return { kind: 'output-close', offset: i, length: 3 };
      if (two === '%}') return { kind: 'tag-close', offset: i, length: 2 };
      if (two === '}}') return { kind: 'output-close', offset: i, length: 2 };
    }
    i--;
  }
  return null;
}

export function bucketCursor(text: string, offset: number): CursorBucket {
  const safeOffset = Math.min(Math.max(0, offset), text.length);

  const adjacentOpen = openImmediatelyBefore(text, safeOffset);
  const hit = adjacentOpen ?? scanBackForOpener(text, safeOffset - 1);
  if (!hit) return { region: 'text', openOffset: -1, body: '' };
  if (hit.kind === 'tag-close' || hit.kind === 'output-close') {
    return { region: 'text', openOffset: -1, body: '' };
  }

  const bodyStart = hit.offset + hit.length;
  if (safeOffset < bodyStart) return { region: 'text', openOffset: -1, body: '' };

  const body = text.slice(bodyStart, safeOffset);

  if (hit.kind === 'output-open') return classifyOutputBody(body, hit.offset);
  return classifyTagBody(body, hit.offset);
}

/**
 * Returns the open delimiter that ends exactly at `cursorOffset`, if any.
 *
 * This is a safety net for cases where VS Code's single-character `{` -> `}`
 * auto-close runs ahead of our multi-character `{%` / `{{` pairs, leaving the
 * buffer in a state like `{%}` with the cursor at offset 2. A naive backward
 * scan from offset 1 finds the `%}` close first; this helper short-circuits
 * that by preferring the matching open that ends right at the cursor.
 */
function openImmediatelyBefore(text: string, cursorOffset: number): DelimiterHit | null {
  if (cursorOffset >= 3) {
    const last3 = text.slice(cursorOffset - 3, cursorOffset);
    if (last3 === '{%-') return { kind: 'tag-open', offset: cursorOffset - 3, length: 3 };
    if (last3 === '{{-') return { kind: 'output-open', offset: cursorOffset - 3, length: 3 };
  }
  if (cursorOffset >= 2) {
    const last2 = text.slice(cursorOffset - 2, cursorOffset);
    if (last2 === '{%') return { kind: 'tag-open', offset: cursorOffset - 2, length: 2 };
    if (last2 === '{{') return { kind: 'output-open', offset: cursorOffset - 2, length: 2 };
  }
  return null;
}

function classifyOutputBody(body: string, openOffset: number): CursorBucket {
  const trimmedLeading = body.replace(/^[\s-]+/, '');
  const pipeMatch = /\|\s*([\w-]*)$/.exec(body);
  if (pipeMatch) {
    return { region: 'output-after-pipe', openOffset, body, filterPartial: pipeMatch[1] ?? '' };
  }

  const paradoxValueDone = /^([a-z]+)\s*:\s*[^\s}]+\s+$/.exec(trimmedLeading);
  if (paradoxValueDone && isParadoxKind(paradoxValueDone[1]!)) {
    return { region: 'paradox-confirmed', openOffset, body, paradoxKind: paradoxValueDone[1]! };
  }

  const paradoxValueTyping = /^([a-z]+)\s*:\s*([^\s}]*)$/.exec(trimmedLeading);
  if (paradoxValueTyping && isParadoxKind(paradoxValueTyping[1]!)) {
    return { region: 'paradox-value-typing', openOffset, body, paradoxKind: paradoxValueTyping[1]! };
  }

  const paradoxIntent = /^([a-z]+)$/.exec(trimmedLeading);
  if (paradoxIntent && couldBeParadoxKind(paradoxIntent[1]!)) {
    return { region: 'paradox-intent', openOffset, body };
  }

  return { region: 'output', openOffset, body };
}

function couldBeParadoxKind(prefix: string): boolean {
  if (prefix.length === 0) return false;
  return ['component', 'snippet', 'data', 'attribute'].some((k) => k.startsWith(prefix));
}

function classifyTagBody(body: string, openOffset: number): CursorBucket {
  const pipeMatch = /\|\s*([\w-]*)$/.exec(body);
  if (pipeMatch) {
    return { region: 'tag-after-pipe', openOffset, body, filterPartial: pipeMatch[1] ?? '' };
  }

  const tagNameMatch = /^[\s-]*([\w-]+)/.exec(body);
  const tagName = tagNameMatch?.[1];

  if (tagName === 'render' || tagName === 'include') {
    const renderArg = new RegExp(`\\b${tagName}\\s+["']([^"']+)["']\\s*,[^%}]*$`).exec(body);
    if (renderArg) {
      return { region: 'render-args', openOffset, body, tagName, renderTarget: renderArg[1] };
    }
    const argsTail = body.slice(body.indexOf(tagName) + tagName.length);
    const stringMatch = /^\s+(["'])([^"']*)$/.exec(argsTail);
    if (stringMatch) {
      return {
        region: tagName === 'render' ? 'string-render-path' : 'string-include-path',
        openOffset,
        body,
        tagName,
      };
    }
  }

  if (tagName === 'layout') {
    const argsTail = body.slice(body.indexOf('layout') + 'layout'.length);
    const stringMatch = /^\s+(["'])([^"']*)$/.exec(argsTail);
    if (stringMatch) {
      return { region: 'string-layout-path', openOffset, body, tagName };
    }
  }

  return { region: 'tag', openOffset, body, tagName };
}

export function dottedPathBefore(body: string): { path: string[] } | null {
  const m = /([\w.]+)\.$/.exec(body);
  if (!m) return null;
  return { path: m[1]!.split('.') };
}
