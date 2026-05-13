import type { ParadoxTag } from '../types.js';

export interface ParadoxKindInfo {
  kind: ParadoxTag['kind'];
  hover: string;
}

export const PARADOX_TAGS: Readonly<Record<ParadoxTag['kind'], ParadoxKindInfo>> = Object.freeze({
  component: { kind: 'component', hover: 'Render the component on Site Studio' },
  snippet: { kind: 'snippet', hover: 'Render the snippet on Site Studio' },
  data: { kind: 'data', hover: 'Render the data for Site Studio' },
  attribute: { kind: 'attribute', hover: 'Render the data for Site Studio' },
});

export function getParadoxHover(kind: string): string | undefined {
  if (kind === 'component' || kind === 'snippet' || kind === 'data' || kind === 'attribute') {
    return PARADOX_TAGS[kind].hover;
  }
  return undefined;
}

export const PARADOX_KIND_REGEX = /^\s*(component|snippet|data|attribute)\s*:\s*([^}\s]+)\s*$/;
