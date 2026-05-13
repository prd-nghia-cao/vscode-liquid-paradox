import type { DocumentModel } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import type { Binding, LiquidType, Range } from '../types.js';
import { getTagInfo } from '../data/tags.js';
import { getFilterInfo } from '../data/filters.js';
import { getParadoxHover } from '../data/paradoxTags.js';

export interface HoverResult {
  markdown: string;
  range?: Range;
}
export interface HoverContext {
  fileIndex: FileIndex;
}

interface Position {
  line: number;
  character: number;
}

export function provideHover(model: DocumentModel, pos: Position, ctx: HoverContext): HoverResult | null {
  for (const tag of model.paradoxTags) {
    if (positionInRange(pos, tag.range)) {
      return { markdown: getParadoxHover(tag.kind)!, range: tag.range };
    }
  }

  const offset = positionToOffset(model.text, pos);
  const word = readWordAt(model.text, offset);
  if (!word) return null;

  const stringCtx = readEnclosingStringLiteral(model.text, offset);
  if (stringCtx) {
    const renderTag = isPathContext(model.text, stringCtx.start, /\brender\s+["']$/);
    if (renderTag) {
      const entry = ctx.fileIndex.components.get(stringCtx.value) ?? ctx.fileIndex.partials.get(stringCtx.value);
      if (entry) return { markdown: `[${entry.absPath}](file://${entry.absPath})` };
    }
    const layoutTag = isPathContext(model.text, stringCtx.start, /\blayout\s+["']$/);
    if (layoutTag) {
      const entry = ctx.fileIndex.layouts.get(stringCtx.value);
      if (entry) return { markdown: `[${entry.absPath}](file://${entry.absPath})` };
    }
  }

  const tag = getTagInfo(word.text);
  if (tag && isAtTagName(model.text, offset, word)) {
    return {
      markdown: `**${tag.name}** — ${tag.description}\n\n\`${tag.syntax}\`\n\n[Docs](${tag.docsUrl})`,
      range: word.range,
    };
  }

  const filter = getFilterInfo(word.text);
  if (filter && isAfterPipeAtIdentifier(model.text, offset)) {
    return {
      markdown: `**${filter.name}** — ${filter.description}\n\n\`${filter.signature}\`\n\n[Docs](${filter.docsUrl})`,
      range: word.range,
    };
  }

  const scope = model.scopeByOffset(offset);
  const binding = scope.get(word.text);
  if (binding) {
    return { markdown: hoverForBinding(binding), range: word.range };
  }
  return null;
}

function hoverForBinding(b: Binding): string {
  const t = typeLabel(b.type);
  const lines: string[] = [`**${b.name}** — \`${t}\``];
  switch (b.origin.kind) {
    case 'json':
      lines.push(`from \`${b.origin.jsonPath}\``);
      break;
    case 'local':
      lines.push(`from local \`${b.origin.tag}\``);
      break;
    case 'componentProp':
      lines.push(`component prop (default \`${b.origin.defaultValue}\`)`);
      break;
    case 'builtin':
      lines.push('built-in');
      break;
  }
  return lines.join('\n\n');
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
      return `{ ${Object.keys(t.properties).join(', ')} }`;
    case 'union':
      return t.variants.map(typeLabel).join(' | ');
  }
}

function isAtTagName(text: string, offset: number, word: { range: Range }): boolean {
  const before = text.slice(0, positionToOffset(text, word.range.start));
  return /\{%-?\s*$/.test(before);
}

function isAfterPipeAtIdentifier(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  return /\|\s*[\w-]*$/.test(before);
}

function isPathContext(text: string, atOffset: number, re: RegExp): boolean {
  return re.test(text.slice(0, atOffset + 1));
}

function readWordAt(text: string, offset: number): { text: string; range: Range } | null {
  if (offset >= text.length) offset = text.length - 1;
  if (offset < 0) return null;
  let start = offset;
  while (start > 0 && /[\w-]/.test(text[start - 1]!)) start--;
  let end = offset;
  while (end < text.length && /[\w-]/.test(text[end]!)) end++;
  if (start === end) return null;
  return {
    text: text.slice(start, end),
    range: { start: offsetToPosition(text, start), end: offsetToPosition(text, end) },
  };
}

function readEnclosingStringLiteral(
  text: string,
  offset: number,
): { value: string; start: number; end: number } | null {
  let openIdx = -1;
  let quote = '';
  for (let i = offset; i >= 0; i--) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      openIdx = i;
      quote = ch;
      break;
    }
    if (ch === '{' || ch === '%') return null;
  }
  if (openIdx === -1) return null;
  const closeIdx = text.indexOf(quote, openIdx + 1);
  if (closeIdx === -1 || closeIdx < offset) return null;
  return { value: text.slice(openIdx + 1, closeIdx), start: openIdx, end: closeIdx };
}

function positionInRange(pos: Position, range: Range): boolean {
  return (
    (pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)) &&
    (pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character))
  );
}

function positionToOffset(text: string, pos: Position): number {
  let line = 0,
    character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return i;
    if (text.charCodeAt(i) === 10) {
      line++;
      character = 0;
    } else character++;
  }
  return text.length;
}

function offsetToPosition(text: string, offset: number): Position {
  let line = 0,
    lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}
