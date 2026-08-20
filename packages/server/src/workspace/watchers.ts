import * as path from 'node:path';
import { applyFileEvent, type FileIndex } from './fileIndex.js';
import { assetKindForPath } from './assetIndex.js';
import type { DepGraph } from './depGraph.js';

export interface WatcherRegistration {
  globPattern: string;
}

export function buildWatcherRegistrations(dirs: {
  pagesDir: string;
  partialsDir: string;
  componentsDir: string;
  layoutsDir: string;
  assetsDir: string;
}): WatcherRegistration[] {
  const liquidDirs = [dirs.componentsDir, dirs.partialsDir, dirs.layoutsDir].join(',');
  const jsonDirs = [dirs.pagesDir, dirs.partialsDir].join(',');
  return [
    { globPattern: '**/vite.config.ts' },
    { globPattern: `{${liquidDirs}}/**/*.liquid` },
    { globPattern: `{${jsonDirs}}/**/*.liquid.json` },
    { globPattern: `${dirs.assetsDir}/**/*` },
  ];
}

export interface RouteInput {
  absPath: string;
  event: 'created' | 'changed' | 'deleted';
  mtime: number;
  dirs: {
    repoRoot: string;
    pagesDir: string;
    partialsDir: string;
    componentsDir: string;
    layoutsDir: string;
    assetsDir: string;
  };
  fileIndex: FileIndex;
  depGraph: DepGraph;
  openUris: string[];
}

export interface RouteOutput {
  rebuildIndex: boolean;
  urisToRediagnose: string[];
  invalidateJsonPath?: string;
  invalidateComponentPropsKey?: string;
  /**
   * A media file under `assetsDir` changed. The caller applies it with
   * {@link applyAssetEvent}, since the index stores a real file size that only
   * the caller can stat.
   */
  assetEvent?: { absPath: string; event: 'created' | 'changed' | 'deleted' };
}

export function routeFileEvent(input: RouteInput): RouteOutput {
  const { absPath, event, mtime, dirs, fileIndex, depGraph } = input;

  if (absPath === path.join(dirs.repoRoot, 'vite.config.ts') || absPath.endsWith(path.sep + 'vite.config.ts')) {
    return { rebuildIndex: true, urisToRediagnose: [] };
  }

  if (absPath.endsWith('.liquid.json')) {
    return {
      rebuildIndex: false,
      urisToRediagnose: depGraph.dependentsOfJson(absPath),
      invalidateJsonPath: absPath,
    };
  }

  if (absPath.endsWith('.liquid')) {
    const beforeKey = findKey(absPath, dirs);
    applyFileEvent(fileIndex, dirs, absPath, event, mtime);
    let urisToRediagnose: string[] = [];
    let propsKey: string | undefined;
    if (beforeKey) {
      if (beforeKey.bucket === 'components') {
        propsKey = beforeKey.key;
        urisToRediagnose = depGraph.dependentsOfRenderKey(beforeKey.key);
      } else if (beforeKey.bucket === 'partials') {
        urisToRediagnose = depGraph.dependentsOfRenderKey(beforeKey.key);
      } else {
        urisToRediagnose = depGraph.dependentsOfLayoutKey(beforeKey.key);
      }
    }
    return { rebuildIndex: false, urisToRediagnose, invalidateComponentPropsKey: propsKey };
  }

  if (isUnderAssets(absPath, dirs.assetsDir) && assetKindForPath(absPath)) {
    return { rebuildIndex: false, urisToRediagnose: [], assetEvent: { absPath, event } };
  }

  return { rebuildIndex: false, urisToRediagnose: [] };
}

function isUnderAssets(absPath: string, assetsDir: string): boolean {
  return absPath.startsWith(assetsDir + path.sep);
}

function findKey(
  absPath: string,
  dirs: RouteInput['dirs'],
): { bucket: 'components' | 'partials' | 'layouts'; key: string } | null {
  for (const [bucket, dir] of [
    ['components', dirs.componentsDir],
    ['partials', dirs.partialsDir],
    ['layouts', dirs.layoutsDir],
  ] as const) {
    if (absPath === dir || absPath.startsWith(dir + path.sep)) {
      const rel = path.relative(dir, absPath);
      if (!rel.endsWith('.liquid')) return null;
      return { bucket, key: rel.slice(0, -'.liquid'.length).split(path.sep).join('/') };
    }
  }
  return null;
}
