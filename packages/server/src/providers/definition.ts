import type { DocumentModel } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import type { Range } from '../types.js';

interface Position {
  line: number;
  character: number;
}
export interface DefinitionResult {
  uri: string;
  range: Range;
}
export interface DefinitionContext {
  fileIndex: FileIndex;
}

export function provideDefinition(
  model: DocumentModel,
  pos: Position,
  ctx: DefinitionContext,
): DefinitionResult | null {
  for (const tag of model.paradoxTags) {
    if (positionInRange(pos, tag.range)) return null;
  }

  const offset = positionToOffset(model.text, pos);

  const stringCtx = readEnclosingStringLiteral(model.text, offset);
  if (stringCtx) {
    const isRender = /\brender\s+["']$/.test(model.text.slice(0, stringCtx.start + 1));
    if (isRender) {
      const entry = ctx.fileIndex.components.get(stringCtx.value) ?? ctx.fileIndex.partials.get(stringCtx.value);
      if (entry) return { uri: 'file://' + entry.absPath, range: zeroRange() };
    }
    const isLayout = /\blayout\s+["']$/.test(model.text.slice(0, stringCtx.start + 1));
    if (isLayout) {
      const entry = ctx.fileIndex.layouts.get(stringCtx.value);
      if (entry) return { uri: 'file://' + entry.absPath, range: zeroRange() };
    }
  }

  const word = readWordAt(model.text, offset);
  if (!word) return null;
  const scope = model.scopeByOffset(offset);
  const binding = scope.get(word.text);
  if (!binding) return null;

  switch (binding.origin.kind) {
    case 'json':
      return { uri: 'file://' + binding.origin.jsonPath, range: binding.origin.jsonKeyRange };
    case 'local':
      return { uri: model.uri, range: binding.origin.declRange };
    case 'componentProp':
      return { uri: 'file://' + binding.origin.componentPath, range: binding.origin.declRange };
    case 'builtin':
      return null;
  }
}

function zeroRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

function positionInRange(pos: Position, range: Range): boolean {
  return (
    (pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)) &&
    (pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character))
  );
}

function readWordAt(text: string, offset: number): { text: string } | null {
  if (offset >= text.length) offset = text.length - 1;
  if (offset < 0) return null;
  let start = offset;
  while (start > 0 && /[\w-]/.test(text[start - 1]!)) start--;
  let end = offset;
  while (end < text.length && /[\w-]/.test(text[end]!)) end++;
  if (start === end) return null;
  return { text: text.slice(start, end) };
}

function readEnclosingStringLiteral(
  text: string,
  offset: number,
): { value: string; start: number; end: number } | null {
  let openIdx = -1,
    quote = '';
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
