import { assetsOfKinds, type AssetIndex, type AssetKind } from '../workspace/assetIndex.js';

interface Position {
  line: number;
  character: number;
}

/**
 * The cursor context an asset list is built for: which kinds belong here and
 * which offsets the accepted URL replaces. Produced by `assetAttributeAt` for
 * HTML attribute values and `jsonAssetContextAt` for `.liquid.json` sidecars.
 */
export interface AssetTarget {
  kinds: ReadonlySet<AssetKind>;
  replaceStart: number;
  replaceEnd: number;
}

export interface AssetCompletionItem {
  label: string;
  detail: string;
  /** Replaces the URL token under the cursor, so retyping a path narrows in place. */
  textEdit: { range: { start: Position; end: Position }; newText: string };
  filterText: string;
  sortText: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Builds completion items for the assets valid in `ctx`. Items are ordered by
 * URL and given a numeric `sortText` so the editor preserves that order instead
 * of re-sorting alphabetically on the leading slash.
 */
export function assetCompletions(
  index: AssetIndex,
  ctx: AssetTarget,
  positionAt: (offset: number) => Position,
): AssetCompletionItem[] {
  const range = { start: positionAt(ctx.replaceStart), end: positionAt(ctx.replaceEnd) };
  return assetsOfKinds(index, ctx.kinds).map((asset, i) => ({
    label: asset.url,
    detail: `${asset.kind} · ${humanSize(asset.size)}`,
    textEdit: { range, newText: asset.url },
    filterText: asset.url,
    sortText: String(i).padStart(5, '0'),
  }));
}
