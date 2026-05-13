import { tokenize, type Token, type TokenizeError } from './tokenize.js';
import { buildAst, type AstError, type AstNode, type RootNode } from './ast.js';
import { buildScopeTable, type ScopeTable } from './scope.js';
import { inferTopLevelBindings } from './jsonSchema.js';
import { extractComponentProps } from './propBlock.js';
import { runParadoxPrepass } from './paradoxPrepass.js';
import type { Binding, Dependencies, ParadoxTag, Range } from '../types.js';

export interface AnalyzeInput {
  uri: string;
  text: string;
  jsonCompanion: { path: string; text: string } | undefined;
  isComponent: boolean;
  componentLookup: (key: string) => Binding[] | undefined;
}

export interface DocumentModel {
  uri: string;
  text: string;
  tokens: Token[];
  tokenErrors: TokenizeError[];
  ast: { root: RootNode };
  astErrors: AstError[];
  scopeByOffset: ScopeTable['scopeAt'];
  paradoxTags: ParadoxTag[];
  paradoxOutputRanges: Set<string>;
  dependencies: Dependencies;
  componentProps?: Binding[];
}

export function analyzeDocument(input: AnalyzeInput): DocumentModel {
  const { tokens, errors: tokenErrors } = tokenize(input.text);
  const { root, errors: astErrors } = buildAst(tokens);

  let rootBindings: Binding[] = [];
  if (input.jsonCompanion) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.jsonCompanion.text);
    } catch {
      parsed = null;
    }
    rootBindings = inferTopLevelBindings(input.jsonCompanion.path, parsed);
    const keyRanges = locateTopLevelKeys(input.jsonCompanion.text);
    rootBindings = rootBindings.map((b) => {
      const r = keyRanges.get(b.name);
      if (r && b.origin.kind === 'json') {
        return { ...b, origin: { ...b.origin, jsonKeyRange: r } };
      }
      return b;
    });
  }

  const { scopeAt } = buildScopeTable(input.text, root, rootBindings);
  const { tags: paradoxTags, paradoxOutputRanges } = runParadoxPrepass(root);

  const dependencies = collectDependencies(root, input.jsonCompanion?.path);
  const componentProps = input.isComponent
    ? extractComponentProps(input.text, root, fileURLToPathSafe(input.uri))
    : undefined;

  return {
    uri: input.uri,
    text: input.text,
    tokens,
    tokenErrors,
    ast: { root },
    astErrors,
    scopeByOffset: scopeAt,
    paradoxTags,
    paradoxOutputRanges,
    dependencies,
    componentProps,
  };
}

function fileURLToPathSafe(uri: string): string {
  if (uri.startsWith('file://')) return uri.slice('file://'.length);
  return uri;
}

function collectDependencies(root: RootNode, jsonCompanion?: string): Dependencies {
  const renderedFiles: string[] = [];
  let layoutFile: string | undefined;

  function walk(nodes: AstNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'tag') {
        if (node.name === 'render' || node.name === 'include') {
          const path = firstStringLiteral(node.args);
          if (path) renderedFiles.push(path);
        } else if (node.name === 'layout') {
          const path = firstStringLiteral(node.args);
          if (path) layoutFile = path;
        }
      } else if (node.kind === 'block') {
        for (const b of node.branches) walk(b.body);
      }
    }
  }
  walk(root.children);

  return { jsonCompanion, renderedFiles, layoutFile };
}

function firstStringLiteral(args: string): string | null {
  const m = args.match(/^["']([^"']+)["']/);
  return m ? m[1]! : null;
}

function locateTopLevelKeys(jsonText: string): Map<string, Range> {
  const ranges = new Map<string, Range>();
  let depth = 0;
  let line = 0,
    col = 0;
  let i = 0;
  let inString = false;
  let stringStart = -1;
  let pendingKey: { name: string; line: number; col: number } | null = null;

  while (i < jsonText.length) {
    const ch = jsonText[i]!;
    if (inString) {
      if (ch === '\\') {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === '"') {
        if (depth === 1 && pendingKey === null) {
          const name = jsonText.slice(stringStart + 1, i);
          pendingKey = { name, line: posLine(jsonText, stringStart), col: posCol(jsonText, stringStart) };
        } else if (depth === 1 && pendingKey !== null) {
          pendingKey = null;
        }
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
        stringStart = i;
      } else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      else if (ch === ':' && depth === 1 && pendingKey) {
        ranges.set(pendingKey.name, {
          start: { line: pendingKey.line, character: pendingKey.col },
          end: { line: pendingKey.line, character: pendingKey.col + pendingKey.name.length + 2 },
        });
        pendingKey = null;
      } else if (ch === ',' && depth === 1) {
        pendingKey = null;
      }
    }
    if (ch === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
    i++;
  }
  return ranges;
}

function posLine(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
function posCol(text: string, offset: number): number {
  let col = 0;
  for (let i = offset - 1; i >= 0; i--) {
    if (text.charCodeAt(i) === 10) break;
    col++;
  }
  return col;
}
