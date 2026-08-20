import type { DocumentModel } from '../analyzer/document.js';
import type { AstNode } from '../analyzer/ast.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import type { Binding, Range } from '../types.js';
import { isKnownTag, isClosingTag } from '../data/tags.js';
import { isKnownFilter } from '../data/filters.js';
import { renderArgNames } from '../analyzer/renderArgs.js';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  range: Range;
  severity: Severity;
  message: string;
  source: 'liquid-paradox';
}

export interface DiagnosticContext {
  fileIndex: FileIndex;
  pathFeaturesEnabled: boolean;
  lookupComponentProps: (key: string) => Binding[] | undefined;
}

export function provideDiagnostics(model: DocumentModel, ctx: DiagnosticContext): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const err of model.tokenErrors)
    out.push({ range: err.range, severity: 'error', message: err.message, source: 'liquid-paradox' });
  for (const err of model.astErrors)
    out.push({ range: err.range, severity: 'error', message: err.message, source: 'liquid-paradox' });

  walk(model.ast.root.children, model, ctx, out);

  return out;
}

function walk(nodes: AstNode[], model: DocumentModel, ctx: DiagnosticContext, out: Diagnostic[]): void {
  for (const node of nodes) {
    if (node.kind === 'output') {
      const key = `${node.range.start.line}:${node.range.start.character}`;
      if (model.paradoxOutputRanges.has(key)) continue;
      checkExpression(node.content, node.rawRange, model, out);
    } else if (node.kind === 'tag') {
      if (node.name === 'render' || node.name === 'include') {
        if (ctx.pathFeaturesEnabled) checkRender(node.args, node.rawRange, ctx, out);
      } else if (node.name === 'layout') {
        if (ctx.pathFeaturesEnabled) checkLayout(node.args, node.rawRange, ctx, out);
      } else if (node.name === 'assign') {
        const expr = node.args.replace(/^[\w-]+\s*=\s*/, '');
        checkExpression(expr, node.rawRange, model, out);
      } else if (node.name === 'echo') {
        checkExpression(node.args, node.rawRange, model, out);
      } else if (!isKnownTag(node.name) && !isClosingTag(node.name)) {
        out.push({
          range: node.range,
          severity: 'error',
          message: `Unknown tag '${node.name}'`,
          source: 'liquid-paradox',
        });
      }
    } else if (node.kind === 'block') {
      for (const b of node.branches) walk(b.body, model, ctx, out);
    }
  }
}

function checkExpression(expr: string, range: Range, model: DocumentModel, out: Diagnostic[]): void {
  const parts = splitOnPipe(expr);
  const main = parts[0]!.trim();
  if (main && /^[\w-]/.test(main)) {
    const root = main.split('.')[0]!;
    const scope = model.scopeByOffset(positionToOffset(model.text, range.start));
    if (!scope.has(root) && !/^"|^'|^-?\d|^true$|^false$|^nil$|^null$/.test(main)) {
      out.push({
        range,
        severity: 'warning',
        message: `Unknown variable '${root}'`,
        source: 'liquid-paradox',
      });
    }
  }
  for (let i = 1; i < parts.length; i++) {
    const filterName = parts[i]!.trim().split(/[\s:]/)[0]!;
    if (filterName && !isKnownFilter(filterName)) {
      out.push({
        range,
        severity: 'error',
        message: `Unknown filter '${filterName}'`,
        source: 'liquid-paradox',
      });
    }
  }
}

function checkRender(args: string, range: Range, ctx: DiagnosticContext, out: Diagnostic[]): void {
  const pathMatch = args.match(/^["']([^"']+)["']/);
  if (!pathMatch) return;
  const key = pathMatch[1]!;
  const isComponent = ctx.fileIndex.components.has(key);
  const isPartial = ctx.fileIndex.partials.has(key);
  if (!isComponent && !isPartial) {
    out.push({ range, severity: 'error', message: `Unresolved render path: '${key}'`, source: 'liquid-paradox' });
    return;
  }
  if (!isComponent) return;
  const props = ctx.lookupComponentProps(key);
  // A component that declares no `assign … | default:` props tells us nothing
  // about what it accepts, so every arg would be flagged. Stay quiet instead.
  if (!props || props.length === 0) return;
  const declared = new Set(props.map((p) => p.name));
  const argList = args.slice(pathMatch[0].length).replace(/^\s*,/, '');
  for (const name of renderArgNames(argList)) {
    if (!declared.has(name)) {
      out.push({
        range,
        severity: 'warning',
        message: `Unknown prop '${name}' on component '${key}'`,
        source: 'liquid-paradox',
      });
    }
  }
}

function checkLayout(args: string, range: Range, ctx: DiagnosticContext, out: Diagnostic[]): void {
  const pathMatch = args.match(/^["']([^"']+)["']/);
  if (!pathMatch) return;
  if (!ctx.fileIndex.layouts.has(pathMatch[1]!)) {
    out.push({
      range,
      severity: 'error',
      message: `Unresolved layout path: '${pathMatch[1]}'`,
      source: 'liquid-paradox',
    });
  }
}

function splitOnPipe(s: string): string[] {
  const out: string[] = [];
  let buf = '',
    inStr: string | null = null;
  for (const ch of s) {
    if (inStr) {
      buf += ch;
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
    } else if (ch === '|') {
      out.push(buf);
      buf = '';
    } else buf += ch;
  }
  out.push(buf);
  return out;
}

function positionToOffset(text: string, pos: { line: number; character: number }): number {
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
