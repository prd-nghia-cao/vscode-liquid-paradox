import type { Binding, LiquidType } from '../types.js';
import type { DocumentModel } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import { TAGS } from '../data/tags.js';
import { FILTERS } from '../data/filters.js';

export interface CompletionItem {
  label: string;
  kind: 'Keyword' | 'Variable' | 'Function' | 'Module' | 'File' | 'Property';
  detail?: string;
  documentation?: string;
}

export interface CompletionContext {
  fileIndex: FileIndex;
  lookupComponentProps: (key: string) => Binding[] | undefined;
}

interface Position {
  line: number;
  character: number;
}

export function provideCompletions(model: DocumentModel, pos: Position, ctx: CompletionContext): CompletionItem[] {
  const offset = positionToOffset(model.text, pos);
  if (isInsideParadoxTag(model, pos)) return [];

  const tagCtx = detectTagOpeningContext(model.text, offset);
  if (tagCtx === 'tagName') return tagCompletions();

  const renderPath = detectStringLiteralContext(model.text, offset, /\brender\s+["']$|\brender\s+["'][^"']*$/);
  if (renderPath) return renderPathCompletions(ctx.fileIndex);

  const layoutPath = detectStringLiteralContext(model.text, offset, /\blayout\s+["']$|\blayout\s+["'][^"']*$/);
  if (layoutPath) return layoutPathCompletions(ctx.fileIndex);

  const renderProps = detectRenderArgContext(model.text, offset);
  if (renderProps) {
    if (!ctx.fileIndex.components.has(renderProps.key)) return [];
    const props = ctx.lookupComponentProps(renderProps.key);
    if (!props) return [];
    return props.map((p) => ({
      label: p.name,
      kind: 'Property' as const,
      detail: `${typeLabel(p.type)} = ${p.origin.kind === 'componentProp' ? p.origin.defaultValue : ''}`,
    }));
  }

  if (isAfterPipe(model.text, offset)) return filterCompletions();
  if (isInExpressionContext(model.text, offset)) return variableCompletions(model, offset);

  return [];
}

function tagCompletions(): CompletionItem[] {
  return Object.values(TAGS).map((t) => ({
    label: t.name,
    kind: 'Keyword',
    detail: 'tag',
    documentation: t.description,
  }));
}

function filterCompletions(): CompletionItem[] {
  return Object.values(FILTERS).map((f) => ({
    label: f.name,
    kind: 'Function',
    detail: f.signature,
    documentation: f.description,
  }));
}

function variableCompletions(model: DocumentModel, offset: number): CompletionItem[] {
  const text = model.text;
  const dotMatch = text.slice(0, offset).match(/([\w.]+)\.$/);
  if (dotMatch) {
    const path = dotMatch[1]!.split('.');
    const scope = model.scopeByOffset(offset);
    const root = scope.get(path[0]!);
    if (!root) return [];
    const t = walkPath(root.type, path.slice(1));
    if (t.kind === 'object') {
      return Object.keys(t.properties).map((k) => ({
        label: k,
        kind: 'Variable',
        detail: typeLabel(t.properties[k]!.type),
      }));
    }
    return [];
  }
  const scope = model.scopeByOffset(offset);
  const out: CompletionItem[] = [];
  for (const [name, binding] of scope) {
    out.push({
      label: name,
      kind: 'Variable',
      detail: variableDetail(binding),
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
  return [...idx.layouts.keys()].map((key) => ({ label: key, kind: 'File', detail: 'layout' }));
}

function detectTagOpeningContext(text: string, offset: number): 'tagName' | null {
  const prefix = text.slice(0, offset);
  const lastOpen = Math.max(prefix.lastIndexOf('{%'), prefix.lastIndexOf('{%-'));
  if (lastOpen === -1) return null;
  const between = prefix.slice(lastOpen);
  if (between.includes('%}') || between.includes('-%}')) return null;
  const afterOpen = between.replace(/^\{%-?/, '');
  if (/^\s*[\w-]*$/.test(afterOpen)) return 'tagName';
  return null;
}

function detectStringLiteralContext(text: string, offset: number, re: RegExp): boolean {
  return re.test(text.slice(0, offset));
}

function detectRenderArgContext(text: string, offset: number): { key: string } | null {
  const prefix = text.slice(0, offset);
  const m = prefix.match(/\brender\s+["']([^"']+)["']\s*,[^%}]*$/);
  if (!m) return null;
  return { key: m[1]! };
}

function isAfterPipe(text: string, offset: number): boolean {
  const prefix = text.slice(0, offset);
  const lastOpen = Math.max(prefix.lastIndexOf('{{'), prefix.lastIndexOf('{%'));
  if (lastOpen === -1) return false;
  const inExpr = prefix.slice(lastOpen);
  if (inExpr.includes('}}') || inExpr.includes('%}')) return false;
  return /\|\s*[\w-]*$/.test(inExpr);
}

function isInExpressionContext(text: string, offset: number): boolean {
  const prefix = text.slice(0, offset);
  const lastOutputOpen = prefix.lastIndexOf('{{');
  const lastOutputClose = prefix.lastIndexOf('}}');
  if (lastOutputOpen > lastOutputClose) return true;
  const lastTagOpen = prefix.lastIndexOf('{%');
  const lastTagClose = prefix.lastIndexOf('%}');
  if (lastTagOpen > lastTagClose) {
    const inTag = prefix.slice(lastTagOpen);
    if (/(assign\s+[\w-]+\s*=|echo\s+)/.test(inTag)) return true;
  }
  return false;
}

function isInsideParadoxTag(model: DocumentModel, pos: Position): boolean {
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
