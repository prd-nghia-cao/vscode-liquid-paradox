import type { Dirent, PathLike } from 'node:fs';
import * as path from 'node:path';

export interface FileIndexEntry {
  absPath: string;
  mtime: number;
}

export interface FileIndex {
  components: Map<string, FileIndexEntry>;
  partials: Map<string, FileIndexEntry>;
  layouts: Map<string, FileIndexEntry>;
}

export interface IndexDirs {
  componentsDir: string;
  partialsDir: string;
  layoutsDir: string;
  pagesDir: string;
}

export interface BuildOpts extends IndexDirs {
  fs: PromiseFs;
}

interface PromiseFs {
  readdir(p: PathLike, opts: { withFileTypes: true }): Promise<Dirent[]>;
  stat(p: PathLike): Promise<{ mtimeMs: number; isFile(): boolean; isDirectory(): boolean }>;
}

export async function buildFileIndex(opts: BuildOpts): Promise<FileIndex> {
  const components = new Map<string, FileIndexEntry>();
  const partials = new Map<string, FileIndexEntry>();
  const layouts = new Map<string, FileIndexEntry>();

  await Promise.all([
    walk(opts.fs, opts.componentsDir, opts.componentsDir, components),
    walk(opts.fs, opts.partialsDir, opts.partialsDir, partials),
    walk(opts.fs, opts.layoutsDir, opts.layoutsDir, layouts),
  ]);

  return { components, partials, layouts };
}

async function walk(pfs: PromiseFs, root: string, current: string, target: Map<string, FileIndexEntry>): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await pfs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(pfs, root, full, target);
    } else if (entry.isFile() && entry.name.endsWith('.liquid') && !entry.name.endsWith('.liquid.json')) {
      const key = path
        .relative(root, full)
        .slice(0, -'.liquid'.length)
        .split(path.sep)
        .join('/');
      const stat = await pfs.stat(full);
      target.set(key, { absPath: full, mtime: stat.mtimeMs });
    }
  }
}

export interface EventDirs {
  componentsDir: string;
  partialsDir: string;
  layoutsDir: string;
}

export function applyFileEvent(
  idx: FileIndex,
  dirs: EventDirs,
  absPath: string,
  event: 'created' | 'changed' | 'deleted',
  mtime: number,
): void {
  const target = classify(absPath, dirs, idx);
  if (!target) return;
  const { map, key } = target;
  if (event === 'deleted') map.delete(key);
  else map.set(key, { absPath, mtime });
}

function classify(
  absPath: string,
  dirs: EventDirs,
  idx: FileIndex,
): { map: Map<string, FileIndexEntry>; key: string } | null {
  if (!absPath.endsWith('.liquid') || absPath.endsWith('.liquid.json')) return null;
  for (const [dir, map] of [
    [dirs.componentsDir, idx.components],
    [dirs.partialsDir, idx.partials],
    [dirs.layoutsDir, idx.layouts],
  ] as const) {
    if (absPath === dir || absPath.startsWith(dir + path.sep)) {
      const rel = path
        .relative(dir, absPath)
        .slice(0, -'.liquid'.length)
        .split(path.sep)
        .join('/');
      return { map, key: rel };
    }
  }
  return null;
}
