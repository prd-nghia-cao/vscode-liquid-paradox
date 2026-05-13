import type { Binding, LiquidType } from '../types.js';
import type { DocumentModel } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import { TAGS } from '../data/tags.js';
import { FILTERS } from '../data/filters.js';
import { LIQUID_BUILTIN_LITERALS } from '../data/literals.js';
import { LIQUID_OPERATORS } from '../data/operators.js';
import { TAG_CONTINUATIONS, tagWantsOperators, tagWantsVariables } from '../data/tagContinuations.js';
import { PARADOX_KINDS, PARADOX_TAGS } from '../data/paradoxTags.js';
import { bucketCursor, dottedPathBefore, type CursorBucket } from './bucketCursor.js';

export interface CompletionItem {
  label: string;
  kind: 'Keyword' | 'Variable' | 'Function' | 'Module' | 'File' | 'Property' | 'Value';
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
  /**
   * When true, `provideCompletions` will NOT auto-pad this item with leading
   * or trailing spaces even if the surrounding delimiters are tight. Use for
   * items whose `insertText` already includes its own whitespace (e.g. the
   * pipe sentinel inserts `' | '`).
   */
  noAutoPad?: boolean;
}

export interface CompletionContext {
  fileIndex: FileIndex;
  lookupComponentProps: (key: string) => Binding[] | undefined;
}

export type CompletionTriggerKind = 'invoked' | 'triggerCharacter' | 'forIncomplete';

interface Position {
  line: number;
  character: number;
}

export function provideCompletions(
  model: DocumentModel,
  pos: Position,
  ctx: CompletionContext,
  triggerKind: CompletionTriggerKind = 'invoked',
): CompletionItem[] {
  const offset = positionToOffset(model.text, pos);
  if (isInsideClassifiedParadoxTag(model, pos)) return [];

  const bucket = bucketCursor(model.text, offset);
  const items = collectItems(model, offset, ctx, triggerKind, bucket);
  return applyPadding(items, bucket, model.text, offset);
}

function collectItems(
  model: DocumentModel,
  offset: number,
  ctx: CompletionContext,
  triggerKind: CompletionTriggerKind,
  bucket: CursorBucket,
): CompletionItem[] {
  switch (bucket.region) {
    case 'text':
      return [];

    case 'tag':
      return tagRegionCompletions(model, offset, bucket);

    case 'tag-after-pipe':
    case 'output-after-pipe':
      return filterCompletions(bucket.filterPartial ?? '');

    case 'output':
      return outputRegionCompletions(model, offset, bucket, triggerKind);

    case 'paradox-intent':
      return paradoxKindCompletions();

    case 'paradox-value-typing':
      return paradoxValueCompletions(bucket.paradoxKind!, ctx);

    case 'paradox-confirmed':
      return [];

    case 'string-render-path':
      return renderPathCompletions(ctx.fileIndex);

    case 'string-include-path':
      return renderPathCompletions(ctx.fileIndex);

    case 'string-layout-path':
      return layoutPathCompletions(ctx.fileIndex);

    case 'render-args': {
      const key = bucket.renderTarget!;
      if (!ctx.fileIndex.components.has(key)) return [];
      const props = ctx.lookupComponentProps(key);
      if (!props) return [];
      return props.map((p) => ({
        label: p.name,
        kind: 'Property' as const,
        detail: `${typeLabel(p.type)} = ${p.origin.kind === 'componentProp' ? p.origin.defaultValue : ''}`,
      }));
    }
  }
}

/**
 * Pads each item's `insertText` with leading/trailing whitespace when the
 * cursor is tight up against an open or close delimiter, so completions
 * produce well-formed Liquid (e.g. `{% if %}` instead of `{%if%}` when the
 * cursor was at offset 2 of `{%%}`).
 *
 * Regions that have their own delimiters (string literals, render-args) are
 * skipped — padding only applies inside `{% … %}` / `{{ … }}` bodies and the
 * pipe-completion regions.
 */
function applyPadding(
  items: CompletionItem[],
  bucket: CursorBucket,
  text: string,
  offset: number,
): CompletionItem[] {
  if (items.length === 0) return items;
  if (!isPaddableRegion(bucket.region)) return items.map(stripPadFlag);

  const bodyBeforeWord = bucket.body.replace(/[\w-]*$/, '');
  const leadNeeded = bodyBeforeWord === '';
  const afterCursor = text.slice(offset);
  const trailNeeded = /^-?(%\}|\}\})/.test(afterCursor);

  if (!leadNeeded && !trailNeeded) return items.map(stripPadFlag);

  return items.map((item) => {
    if (item.noAutoPad) return stripPadFlag(item);
    const base = item.insertText ?? item.label;
    const lead = leadNeeded ? ' ' : '';
    const trail = trailNeeded ? ' ' : '';
    return stripPadFlag({ ...item, insertText: `${lead}${base}${trail}` });
  });
}

function stripPadFlag(item: CompletionItem): CompletionItem {
  if (!('noAutoPad' in item)) return item;
  const { noAutoPad: _ignored, ...rest } = item;
  return rest;
}

function isPaddableRegion(region: CursorBucket['region']): boolean {
  return (
    region === 'tag' ||
    region === 'output' ||
    region === 'tag-after-pipe' ||
    region === 'output-after-pipe' ||
    region === 'paradox-intent' ||
    region === 'paradox-value-typing'
  );
}

function tagRegionCompletions(model: DocumentModel, offset: number, bucket: CursorBucket): CompletionItem[] {
  const body = bucket.body;
  const tagName = bucket.tagName;
  const bodyTrimmedLeading = body.replace(/^[\s-]+/, '');

  const onlyTagNameSoFar = tagName !== undefined && bodyTrimmedLeading === tagName;
  const noTagYet = tagName === undefined;

  if (noTagYet || onlyTagNameSoFar) {
    return tagNameCompletions();
  }

  const out: CompletionItem[] = [];

  const continuations = tagName ? TAG_CONTINUATIONS[tagName] : undefined;
  if (continuations) {
    for (const k of continuations) {
      out.push({
        label: k.name,
        kind: 'Keyword',
        detail: k.detail,
        documentation: k.description,
        sortText: k.sortText ?? '5',
      });
    }
  }

  if (tagName && tagWantsVariables(tagName)) {
    const dotted = dottedPathBefore(body);
    if (dotted) {
      const scope = model.scopeByOffset(offset);
      const root = scope.get(dotted.path[0]!);
      if (root) {
        const t = walkPath(root.type, dotted.path.slice(1));
        if (t.kind === 'object') {
          for (const k of Object.keys(t.properties)) {
            out.push({ label: k, kind: 'Variable', detail: typeLabel(t.properties[k]!.type) });
          }
        }
      }
      return out;
    }
    for (const item of inScopeVariables(model, offset)) out.push(item);
  }

  if (tagName && tagWantsOperators(tagName)) {
    for (const op of LIQUID_OPERATORS) {
      out.push({
        label: op.name,
        kind: 'Keyword',
        detail: 'operator',
        documentation: op.description,
        sortText: '7',
      });
    }
  }

  return out;
}

function outputRegionCompletions(
  model: DocumentModel,
  offset: number,
  bucket: CursorBucket,
  _triggerKind: CompletionTriggerKind,
): CompletionItem[] {
  const dotted = dottedPathBefore(bucket.body);
  if (dotted) {
    const scope = model.scopeByOffset(offset);
    const root = scope.get(dotted.path[0]!);
    if (!root) return [];
    const t = walkPath(root.type, dotted.path.slice(1));
    if (t.kind !== 'object') return [];
    return Object.keys(t.properties).map((k) => ({
      label: k,
      kind: 'Variable' as const,
      detail: typeLabel(t.properties[k]!.type),
    }));
  }

  const out: CompletionItem[] = [];
  out.push(pipeSentinel());
  for (const item of inScopeVariables(model, offset)) out.push(item);
  for (const lit of LIQUID_BUILTIN_LITERALS) {
    out.push({
      label: lit.name,
      kind: 'Value',
      detail: 'built-in',
      documentation: lit.description,
      sortText: '8',
    });
  }
  return out;
}

function pipeSentinel(): CompletionItem {
  return {
    label: '|',
    kind: 'Keyword',
    detail: 'pipe to a filter',
    documentation: 'Insert ` | ` and trigger the filter list.',
    insertText: ' | ',
    sortText: '0',
    noAutoPad: true,
  };
}

function tagNameCompletions(): CompletionItem[] {
  return Object.values(TAGS).map((t) => ({
    label: t.name,
    kind: 'Keyword' as const,
    detail: 'tag',
    documentation: t.description,
  }));
}

function filterCompletions(partial: string): CompletionItem[] {
  const items = Object.values(FILTERS).map((f) => ({
    label: f.name,
    kind: 'Function' as const,
    detail: f.signature,
    documentation: f.description,
  }));
  if (!partial) return items;
  return items;
}

function inScopeVariables(model: DocumentModel, offset: number): CompletionItem[] {
  const scope = model.scopeByOffset(offset);
  const out: CompletionItem[] = [];
  for (const [name, binding] of scope) {
    out.push({
      label: name,
      kind: 'Variable',
      detail: variableDetail(binding),
      sortText: '3',
    });
  }
  return out;
}

function variableDetail(b: Binding): string {
  const t = typeLabel(b.type);
  switch (b.origin.kind) {
    case 'json':
      return `${t} — from .liquid.json`;
    case 'local':
      return `${t} — ${b.origin.tag}`;
    case 'componentProp':
      return `${t} — prop`;
    case 'builtin':
      return `${t} — built-in`;
  }
}

function renderPathCompletions(idx: FileIndex): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const key of idx.components.keys()) {
    out.push({ label: key, kind: 'Module', detail: 'component' });
  }
  for (const key of idx.partials.keys()) {
    out.push({ label: key, kind: 'File', detail: 'partial' });
  }
  return out;
}

function layoutPathCompletions(idx: FileIndex): CompletionItem[] {
  return [...idx.layouts.keys()].map((key) => ({ label: key, kind: 'File' as const, detail: 'layout' }));
}

function paradoxKindCompletions(): CompletionItem[] {
  return PARADOX_KINDS.map((k) => ({
    label: k,
    kind: 'Keyword' as const,
    detail: 'paradox tag',
    documentation: PARADOX_TAGS[k].hover,
    insertText: `${k}:`,
    sortText: '1',
  }));
}

function paradoxValueCompletions(kind: string, _ctx: CompletionContext): CompletionItem[] {
  return [
    {
      label: `<${kind}-id>`,
      kind: 'Module',
      detail: `paradox ${kind} value — populated by workspace index in a future change`,
      documentation: `Type the identifier of the ${kind} you want to render.`,
      sortText: '5',
    },
  ];
}

function isInsideClassifiedParadoxTag(model: DocumentModel, pos: Position): boolean {
  for (const tag of model.paradoxTags) {
    if (positionInRange(pos, tag.range)) return true;
  }
  return false;
}

function positionInRange(pos: Position, range: { start: Position; end: Position }): boolean {
  return (
    (pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)) &&
    (pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character))
  );
}

function typeLabel(t: LiquidType): string {
  switch (t.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'unknown':
      return t.kind;
    case 'array':
      return `Array<${typeLabel(t.element)}>`;
    case 'object':
      return `{ ${Object.keys(t.properties).slice(0, 3).join(', ')}${Object.keys(t.properties).length > 3 ? ', ...' : ''} }`;
    case 'union':
      return t.variants.map(typeLabel).join(' | ');
  }
}

function walkPath(type: LiquidType, segments: string[]): LiquidType {
  let t = type;
  for (const s of segments) {
    if (t.kind === 'object' && t.properties[s]) t = t.properties[s]!.type;
    else if (t.kind === 'array' && /^\d+$/.test(s)) t = t.element;
    else return { kind: 'unknown' };
  }
  return t;
}

function positionToOffset(text: string, pos: Position): number {
  let line = 0,
    character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return i;
    if (text.charCodeAt(i) === 10) {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return text.length;
}
