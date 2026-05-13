import type { AstNode, RootNode } from './ast.js';
import type { ParadoxTag } from '../types.js';
import { PARADOX_KIND_REGEX } from '../data/paradoxTags.js';

export interface ParadoxPrepassResult {
  tags: ParadoxTag[];
  paradoxOutputRanges: Set<string>;
}

export function runParadoxPrepass(root: RootNode): ParadoxPrepassResult {
  const tags: ParadoxTag[] = [];
  const paradoxOutputRanges = new Set<string>();
  walk(root.children, tags, paradoxOutputRanges);
  return { tags, paradoxOutputRanges };
}

function walk(nodes: AstNode[], tags: ParadoxTag[], set: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === 'output') {
      const m = node.content.match(PARADOX_KIND_REGEX);
      if (m) {
        tags.push({
          kind: m[1] as ParadoxTag['kind'],
          value: m[2]!,
          range: node.range,
        });
        set.add(`${node.range.start.line}:${node.range.start.character}`);
      }
    } else if (node.kind === 'block') {
      for (const b of node.branches) walk(b.body, tags, set);
    }
  }
}
