import type { Dirent, PathLike } from 'node:fs';
import * as path from 'node:path';

export type AssetKind = 'image' | 'video' | 'audio';

export interface AssetEntry {
  /**
   * Root-relative URL the asset is served at. `plugins/static-assets.ts`
   * resolves an incoming request path directly under the assets directory, so
   * `src/assets/img/team.webp` is served at `/img/team.webp`.
   */
  url: string;
  absPath: string;
  kind: AssetKind;
  /** File size in bytes, surfaced in completion detail. */
  size: number;
}

export interface AssetIndex {
  /** Keyed by {@link AssetEntry.url}. */
  assets: Map<string, AssetEntry>;
}

const EXTENSIONS: Record<string, AssetKind> = {
  // image
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.svg': 'image',
  '.ico': 'image',
  // video
  '.mp4': 'video',
  '.webm': 'video',
  '.ogv': 'video',
  '.mov': 'video',
  '.m4v': 'video',
  // audio
  '.mp3': 'audio',
  '.ogg': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.flac': 'audio',
};

/** The asset kind implied by a path's extension, or `undefined` if not media. */
export function assetKindForPath(p: string): AssetKind | undefined {
  return EXTENSIONS[path.extname(p).toLowerCase()];
}

/** Converts an absolute path under `assetsDir` to its root-relative served URL. */
export function assetUrl(assetsDir: string, absPath: string): string {
  return '/' + path.relative(assetsDir, absPath).split(path.sep).join('/');
}

interface PromiseFs {
  readdir(p: PathLike, opts: { withFileTypes: true }): Promise<Dirent[]>;
  stat(p: PathLike): Promise<{ size: number }>;
}

export interface BuildAssetIndexOpts {
  assetsDir: string;
  fs: PromiseFs;
}

export function emptyAssetIndex(): AssetIndex {
  return { assets: new Map() };
}

export async function buildAssetIndex(opts: BuildAssetIndexOpts): Promise<AssetIndex> {
  const assets = new Map<string, AssetEntry>();
  await walk(opts.fs, opts.assetsDir, opts.assetsDir, assets);
  return { assets };
}

async function walk(pfs: PromiseFs, root: string, current: string, target: Map<string, AssetEntry>): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await pfs.readdir(current, { withFileTypes: true });
  } catch {
    // A missing assets directory is normal — asset completions simply stay empty.
    return;
  }

  for (const entry of entries) {
    // `.DS_Store`, `.gitkeep` and friends are never authored into markup.
    if (entry.name.startsWith('.')) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(pfs, root, full, target);
      continue;
    }
    if (!entry.isFile()) continue;
    const kind = assetKindForPath(entry.name);
    if (!kind) continue;
    let size = 0;
    try {
      size = (await pfs.stat(full)).size;
    } catch {
      // Keep the entry; only the size hint is lost.
    }
    target.set(assetUrl(root, full), { url: assetUrl(root, full), absPath: full, kind, size });
  }
}

/** Applies a single watched-file event to an existing index in place. */
export function applyAssetEvent(
  idx: AssetIndex,
  assetsDir: string,
  absPath: string,
  event: 'created' | 'changed' | 'deleted',
  size: number,
): void {
  if (absPath !== assetsDir && !absPath.startsWith(assetsDir + path.sep)) return;
  const kind = assetKindForPath(absPath);
  if (!kind) return;
  if (path.basename(absPath).startsWith('.')) return;
  const url = assetUrl(assetsDir, absPath);
  if (event === 'deleted') idx.assets.delete(url);
  else idx.assets.set(url, { url, absPath, kind, size });
}

/** All indexed assets whose kind is in `kinds`, sorted by URL. */
export function assetsOfKinds(idx: AssetIndex, kinds: ReadonlySet<AssetKind>): AssetEntry[] {
  return [...idx.assets.values()].filter((a) => kinds.has(a.kind)).sort((a, b) => a.url.localeCompare(b.url));
}
