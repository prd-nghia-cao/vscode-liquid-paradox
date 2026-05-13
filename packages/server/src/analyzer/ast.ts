import type { Range } from '../types.js';
import type { Token } from './tokenize.js';
import { getOpeningForClosing, isClosingTag, TAGS } from '../data/tags.js';

export type AstNode =
  | { kind: 'html'; text: string; range: Range }
  | { kind: 'output'; content: string; range: Range; rawRange: Range }
  | { kind: 'tag'; name: string; args: string; range: Range; rawRange: Range }
  | { kind: 'block'; openName: string; openArgs: string; range: Range; branches: BlockBranch[] };

export interface BlockBranch {
  name: string;
  args: string;
  range: Range;
  body: AstNode[];
}

export interface RootNode {
  children: AstNode[];
}

export interface AstError {
  message: string;
  range: Range;
}

export interface AstResult {
  root: RootNode;
  errors: AstError[];
}

const BLOCK_OPENERS = new Set(['if', 'unless', 'for', 'case', 'capture', 'tablerow', 'raw', 'comment']);

const BRANCH_KEYWORDS: Record<string, string[]> = {
  if: ['elsif', 'else'],
  unless: ['else'],
  case: ['when', 'else'],
  for: ['else'],
  tablerow: [],
};

export function buildAst(tokens: Token[]): AstResult {
  const errors: AstError[] = [];

  interface Frame {
    openName: string;
    openArgs: string;
    openRange: Range;
    branches: BlockBranch[];
    currentBranch: BlockBranch;
  }

  const stack: Frame[] = [];
  const root: RootNode = { children: [] };

  function currentChildren(): AstNode[] {
    if (stack.length === 0) return root.children;
    return stack[stack.length - 1]!.currentBranch.body;
  }

  for (const tok of tokens) {
    if (tok.kind === 'html') {
      currentChildren().push({ kind: 'html', text: tok.text, range: tok.range });
      continue;
    }
    if (tok.kind === 'output') {
      currentChildren().push({ kind: 'output', content: tok.content, range: tok.range, rawRange: tok.rawRange });
      continue;
    }

    const name = tok.name;
    const top = stack[stack.length - 1];

    if (BLOCK_OPENERS.has(name)) {
      const branch: BlockBranch = { name, args: tok.args, range: tok.range, body: [] };
      stack.push({
        openName: name,
        openArgs: tok.args,
        openRange: tok.range,
        branches: [branch],
        currentBranch: branch,
      });
      continue;
    }

    if (top && BRANCH_KEYWORDS[top.openName]?.includes(name)) {
      const branch: BlockBranch = { name, args: tok.args, range: tok.range, body: [] };
      top.branches.push(branch);
      top.currentBranch = branch;
      continue;
    }

    if (isClosingTag(name)) {
      const opener = getOpeningForClosing(name);
      if (!top) {
        errors.push({ message: `Unexpected closing tag '${name}' with no matching opener`, range: tok.range });
        continue;
      }
      if (opener !== top.openName) {
        errors.push({
          message: `Mismatched closing tag: expected 'end${top.openName}', got '${name}'`,
          range: tok.range,
        });
      }
      const frame = stack.pop()!;
      currentChildren().push({
        kind: 'block',
        openName: frame.openName,
        openArgs: frame.openArgs,
        range: { start: frame.openRange.start, end: tok.range.end },
        branches: frame.branches,
      });
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(TAGS, name)) {
      // Leave the unknown-tag warning to diagnostics; AST still records it.
    }
    currentChildren().push({
      kind: 'tag',
      name,
      args: tok.args,
      range: tok.range,
      rawRange: tok.rawRange,
    });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    errors.push({
      message: `Unclosed block '${frame.openName}' (expected 'end${frame.openName}')`,
      range: frame.openRange,
    });
    root.children.push({
      kind: 'block',
      openName: frame.openName,
      openArgs: frame.openArgs,
      range: frame.openRange,
      branches: frame.branches,
    });
  }

  return { root, errors };
}
