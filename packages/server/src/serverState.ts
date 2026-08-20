import { parseViteConfig, type ResolvedPaths } from './workspace/viteConfig.js';
import { type FileIndex } from './workspace/fileIndex.js';
import { emptyAssetIndex, type AssetIndex } from './workspace/assetIndex.js';
import { createDocumentStore, type DocumentStore } from './workspace/documentStore.js';
import { createDepGraph, type DepGraph } from './workspace/depGraph.js';
import { extractComponentProps } from './analyzer/propBlock.js';
import { tokenize } from './analyzer/tokenize.js';
import { buildAst } from './analyzer/ast.js';
import type { Binding } from './types.js';

export interface ServerStateDeps {
  readVite: () => { text: string; repoRoot: string } | undefined;
  readFileSync: (path: string) => string | undefined;
  buildFileIndex: (dirs: ResolvedPaths) => Promise<FileIndex>;
  buildAssetIndex: (dirs: ResolvedPaths) => Promise<AssetIndex>;
}

export interface ServerState {
  pathFeaturesEnabled: boolean;
  /** Human-readable outcome of the last {@link ServerState.refreshConfig} call. */
  configStatus: string;
  dirs?: ResolvedPaths;
  fileIndex: FileIndex;
  assetIndex: AssetIndex;
  documentStore: DocumentStore;
  depGraph: DepGraph;
  refreshConfig(): Promise<void>;
  lookupComponentProps(key: string): Binding[] | undefined;
  invalidateComponentProps(keyOrAbsPath: string): void;
  invalidateJsonCompanion(absPath: string): void;
}

export function createServerState(deps: ServerStateDeps): ServerState {
  let pathFeaturesEnabled = false;
  let configStatus = 'not loaded yet';
  let dirs: ResolvedPaths | undefined;
  let fileIndex: FileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
  let assetIndex: AssetIndex = emptyAssetIndex();
  const componentPropsCache = new Map<string, Binding[]>();
  const jsonCompanionCache = new Map<string, string>();

  const documentStore = createDocumentStore({
    isComponentUri: (uri) => {
      if (!dirs) return false;
      const abs = uri.replace('file://', '');
      return abs.startsWith(dirs.componentsDir);
    },
    readJsonCompanion: (path) => {
      const cached = jsonCompanionCache.get(path);
      if (cached !== undefined) return cached;
      const text = deps.readFileSync(path);
      if (text !== undefined) jsonCompanionCache.set(path, text);
      return text;
    },
    lookupComponent: (key) => state.lookupComponentProps(key),
    uriToPath: (u) => u.replace('file://', ''),
  });

  const depGraph = createDepGraph();

  const state: ServerState = {
    get pathFeaturesEnabled() {
      return pathFeaturesEnabled;
    },
    get configStatus() {
      return configStatus;
    },
    get dirs() {
      return dirs;
    },
    get fileIndex() {
      return fileIndex;
    },
    get assetIndex() {
      return assetIndex;
    },
    documentStore,
    depGraph,
    async refreshConfig() {
      componentPropsCache.clear();
      jsonCompanionCache.clear();
      const vite = deps.readVite();
      if (!vite) {
        configStatus = 'no vite config found — path, render-path and render-arg features are disabled';
        pathFeaturesEnabled = false;
        dirs = undefined;
        fileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
        assetIndex = emptyAssetIndex();
        return;
      }
      const result = parseViteConfig(vite.text, vite.repoRoot);
      if (!result.ok) {
        configStatus = `vite config not usable (${result.reason}) — path, render-path and render-arg features are disabled`;
        pathFeaturesEnabled = false;
        dirs = undefined;
        fileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
        assetIndex = emptyAssetIndex();
        return;
      }
      pathFeaturesEnabled = true;
      dirs = result.paths;
      [fileIndex, assetIndex] = await Promise.all([
        deps.buildFileIndex(result.paths),
        deps.buildAssetIndex(result.paths),
      ]);
      configStatus =
        `indexed ${fileIndex.components.size} component(s), ${fileIndex.partials.size} partial(s), ` +
        `${fileIndex.layouts.size} layout(s) from ${result.paths.componentsDir}; ` +
        `${assetIndex.assets.size} asset(s) from ${result.paths.assetsDir}`;
    },
    lookupComponentProps(key) {
      const entry = fileIndex.components.get(key);
      if (!entry) return undefined;
      const cached = componentPropsCache.get(entry.absPath);
      if (cached) return cached;
      const text = deps.readFileSync(entry.absPath);
      if (text === undefined) return undefined;
      const { tokens } = tokenize(text);
      const { root } = buildAst(tokens);
      const props = extractComponentProps(text, root, entry.absPath);
      componentPropsCache.set(entry.absPath, props);
      return props;
    },
    invalidateComponentProps(keyOrAbsPath) {
      if (keyOrAbsPath.startsWith('/')) {
        componentPropsCache.delete(keyOrAbsPath);
      } else {
        const entry = fileIndex.components.get(keyOrAbsPath);
        if (entry) componentPropsCache.delete(entry.absPath);
      }
    },
    invalidateJsonCompanion(absPath) {
      jsonCompanionCache.delete(absPath);
    },
  };

  return state;
}
