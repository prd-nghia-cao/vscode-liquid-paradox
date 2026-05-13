import { parseViteConfig, type ResolvedPaths } from './workspace/viteConfig.js';
import { type FileIndex } from './workspace/fileIndex.js';
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
}

export interface ServerState {
  pathFeaturesEnabled: boolean;
  dirs?: ResolvedPaths;
  fileIndex: FileIndex;
  documentStore: DocumentStore;
  depGraph: DepGraph;
  refreshConfig(): Promise<void>;
  lookupComponentProps(key: string): Binding[] | undefined;
  invalidateComponentProps(keyOrAbsPath: string): void;
  invalidateJsonCompanion(absPath: string): void;
}

export function createServerState(deps: ServerStateDeps): ServerState {
  let pathFeaturesEnabled = false;
  let dirs: ResolvedPaths | undefined;
  let fileIndex: FileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
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
    get dirs() {
      return dirs;
    },
    get fileIndex() {
      return fileIndex;
    },
    documentStore,
    depGraph,
    async refreshConfig() {
      componentPropsCache.clear();
      jsonCompanionCache.clear();
      const vite = deps.readVite();
      if (!vite) {
        pathFeaturesEnabled = false;
        dirs = undefined;
        fileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
        return;
      }
      const result = parseViteConfig(vite.text, vite.repoRoot);
      if (!result.ok) {
        pathFeaturesEnabled = false;
        dirs = undefined;
        fileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
        return;
      }
      pathFeaturesEnabled = true;
      dirs = result.paths;
      fileIndex = await deps.buildFileIndex(result.paths);
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
