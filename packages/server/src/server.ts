import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  CompletionTriggerKind,
  type InitializeResult,
  type CompletionItem as LspCompletionItem,
  CompletionItemKind,
  type Diagnostic as LspDiagnostic,
  type Definition,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServerState } from './serverState.js';
import { buildFileIndex } from './workspace/fileIndex.js';
import { applyAssetEvent, buildAssetIndex } from './workspace/assetIndex.js';
import { buildWatcherRegistrations } from './workspace/watchers.js';
import { provideCompletions, type CompletionTriggerKind as InternalTriggerKind } from './providers/completion.js';
import { COMPLETION_TRIGGER_CHARACTERS } from './serverCapabilities.js';
import { provideHover } from './providers/hover.js';
import { provideDefinition } from './providers/definition.js';
import { provideDiagnostics, type Severity } from './providers/diagnostics.js';
import { getHtmlService, getHtmlContext, isInHtmlRegion, disposeHtmlContext } from './providers/html/htmlService.js';
import { assetAttributeAt } from './providers/html/assetAttribute.js';
import { assetCompletions, type AssetCompletionItem } from './providers/assetCompletion.js';
import { jsonAssetContextAt } from './providers/json/jsonAssetContext.js';
import { routeFileEvent } from './workspace/watchers.js';

/**
 * A `.liquid.json` sidecar holds a template's data, not Liquid source. Those
 * documents are synced only so media keys can offer assets, so every
 * Liquid-analyzing handler must skip them — the tokenizer would report the whole
 * file as errors.
 */
function isJsonSidecar(uri: string): boolean {
  return uri.endsWith('.liquid.json');
}

export function createServer(): void {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  let workspaceRoot: string | undefined;
  const state = createServerState({
    readVite: () => {
      if (!workspaceRoot) return undefined;
      const found = findViteConfig(workspaceRoot);
      if (!found) {
        connection.console.log(`[config] no vite config found under ${workspaceRoot} — path features disabled`);
        return undefined;
      }
      try {
        return { text: fs.readFileSync(found, 'utf8'), repoRoot: path.dirname(found) };
      } catch {
        return undefined;
      }
    },
    readFileSync: (p) => {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return undefined;
      }
    },
    buildFileIndex: (dirs) => buildFileIndex({ ...dirs, fs: fs.promises }),
    buildAssetIndex: (dirs) => buildAssetIndex({ assetsDir: dirs.assetsDir, fs: fs.promises }),
  });

  const debounceTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Locates the site's vite config. Prefers the workspace root, then falls back
   * to a shallow (depth-2) scan so that opening a parent folder — or a monorepo
   * whose site lives in a subdirectory — still enables the path features that
   * `{% render %}` argument completion depends on.
   */
  function findViteConfig(root: string): string | undefined {
    const names = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];
    const inDir = (dir: string): string | undefined => {
      for (const name of names) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) return p;
      }
      return undefined;
    };

    const atRoot = inDir(root);
    if (atRoot) return atRoot;

    const skip = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'coverage']);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith('.')) continue;
      const found = inDir(path.join(root, entry.name));
      if (found) return found;
    }
    return undefined;
  }

  connection.onInitialize((params): InitializeResult => {
    workspaceRoot = params.rootUri
      ? params.rootUri.replace('file://', '')
      : (params.workspaceFolders?.[0]?.uri.replace('file://', '') ?? process.cwd());
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
          triggerCharacters: [...COMPLETION_TRIGGER_CHARACTERS],
        },
        hoverProvider: true,
        definitionProvider: true,
      },
    };
  });

  connection.onInitialized(async () => {
    await state.refreshConfig();
    connection.console.log(`[config] root=${workspaceRoot} — ${state.configStatus}`);
    if (state.dirs) {
      const regs = buildWatcherRegistrations(state.dirs);
      await connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: regs.map((r) => ({ globPattern: r.globPattern })),
      });
    }
    for (const doc of documents.all()) {
      if (!isJsonSidecar(doc.uri)) analyzeAndPublish(doc);
    }
  });

  documents.onDidOpen((e) => {
    if (!isJsonSidecar(e.document.uri)) analyzeAndPublish(e.document);
  });
  documents.onDidChangeContent((e) => {
    if (!isJsonSidecar(e.document.uri)) debouncedDiagnose(e.document);
  });
  documents.onDidClose((e) => {
    state.documentStore.remove(e.document.uri);
    state.depGraph.remove(e.document.uri);
    disposeHtmlContext(e.document.uri);
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) {
      connection.console.log(`[completion] no document for ${params.textDocument.uri}`);
      return [];
    }
    if (isJsonSidecar(doc.uri)) {
      const jsonCtx = jsonAssetContextAt(doc.getText(), doc.offsetAt(params.position));
      const items = jsonCtx ? assetCompletions(state.assetIndex, jsonCtx, (o) => doc.positionAt(o)) : [];
      connection.console.log(
        `[completion] pos=L${params.position.line}:C${params.position.character} ` +
          `region=json-sidecar(${jsonCtx?.keyPath ?? 'none'}) items=${items.length}`,
      );
      return items.map(toAssetItem);
    }
    const htmlText = doc.getText();
    const htmlOffset = doc.offsetAt(params.position);
    const htmlCtx = getHtmlContext(doc.uri, doc.version, htmlText);
    if (isInHtmlRegion(htmlText, htmlOffset, htmlCtx.spans)) {
      // `src` / `srcset` / `poster` values get assets from the workspace's
      // static asset directory instead of the HTML service's (empty) value set.
      const assetCtx = assetAttributeAt(htmlCtx.virtualDoc.getText(), htmlCtx.htmlDoc, htmlOffset);
      if (assetCtx) {
        const items = assetCompletions(state.assetIndex, assetCtx, (o) => htmlCtx.virtualDoc.positionAt(o));
        connection.console.log(
          `[completion] pos=L${params.position.line}:C${params.position.character} ` +
            `region=asset(${assetCtx.tag}@${assetCtx.attribute}) items=${items.length}`,
        );
        return items.map(toAssetItem);
      }
      const list = getHtmlService().doComplete(htmlCtx.virtualDoc, params.position, htmlCtx.htmlDoc);
      connection.console.log(
        `[completion] pos=L${params.position.line}:C${params.position.character} region=html items=${list.items.length}`,
      );
      return list.items;
    }
    const model = state.documentStore.update(doc.uri, doc.getText());
    const triggerKind = toInternalTriggerKind(params.context?.triggerKind);
    const items = provideCompletions(
      model,
      params.position,
      {
        fileIndex: state.fileIndex,
        lookupComponentProps: (k) => state.lookupComponentProps(k),
      },
      triggerKind,
    );
    const around = describeCursor(doc.getText(), params.position);
    connection.console.log(
      `[completion] pos=L${params.position.line}:C${params.position.character} ` +
        `trigger=${triggerKind} char=${JSON.stringify(params.context?.triggerCharacter ?? null)} ` +
        `around=${JSON.stringify(around)} items=${items.length}`,
    );
    return items.map(
      (i) =>
        ({
          label: i.label,
          kind: lspCompletionKind(i.kind),
          detail: i.detail,
          documentation: i.documentation,
          insertText: i.insertText,
          sortText: i.sortText,
        }) satisfies LspCompletionItem,
    );
  });

  function toAssetItem(i: AssetCompletionItem): LspCompletionItem {
    return {
      label: i.label,
      kind: CompletionItemKind.File,
      detail: i.detail,
      filterText: i.filterText,
      sortText: i.sortText,
      textEdit: i.textEdit,
    };
  }

  function describeCursor(text: string, pos: { line: number; character: number }): string {
    const lines = text.split('\n');
    const line = lines[pos.line] ?? '';
    const before = line.slice(Math.max(0, pos.character - 6), pos.character);
    const after = line.slice(pos.character, Math.min(line.length, pos.character + 6));
    return `${before}|${after}`;
  }

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || isJsonSidecar(doc.uri)) return null;
    const hoverText = doc.getText();
    const hoverOffset = doc.offsetAt(params.position);
    const hoverCtx = getHtmlContext(doc.uri, doc.version, hoverText);
    if (isInHtmlRegion(hoverText, hoverOffset, hoverCtx.spans)) {
      return getHtmlService().doHover(hoverCtx.virtualDoc, params.position, hoverCtx.htmlDoc);
    }
    const model = state.documentStore.update(doc.uri, doc.getText());
    const h = provideHover(model, params.position, { fileIndex: state.fileIndex });
    if (!h) return null;
    return { contents: { kind: 'markdown', value: h.markdown }, range: h.range };
  });

  connection.onDefinition((params): Definition | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || isJsonSidecar(doc.uri)) return null;
    const model = state.documentStore.update(doc.uri, doc.getText());
    const d = provideDefinition(model, params.position, { fileIndex: state.fileIndex });
    return d ? { uri: d.uri, range: d.range } : null;
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    if (!state.dirs || !workspaceRoot) return;
    let needRebuild = false;
    const allRediag = new Set<string>();
    for (const change of params.changes) {
      const absPath = change.uri.replace('file://', '');
      const mtime = Date.now();
      const event = change.type === 1 ? 'created' : change.type === 3 ? 'deleted' : 'changed';
      const out = routeFileEvent({
        absPath,
        event,
        mtime,
        dirs: { repoRoot: workspaceRoot, ...state.dirs },
        fileIndex: state.fileIndex,
        depGraph: state.depGraph,
        openUris: documents.all().map((d) => d.uri),
      });
      if (out.rebuildIndex) needRebuild = true;
      if (out.invalidateJsonPath) state.invalidateJsonCompanion(out.invalidateJsonPath);
      if (out.invalidateComponentPropsKey) state.invalidateComponentProps(out.invalidateComponentPropsKey);
      if (out.assetEvent) {
        let size = 0;
        try {
          size = fs.statSync(out.assetEvent.absPath).size;
        } catch {
          // Deleted files have no size; applyAssetEvent ignores it for removals.
        }
        applyAssetEvent(state.assetIndex, state.dirs.assetsDir, out.assetEvent.absPath, out.assetEvent.event, size);
      }
      for (const u of out.urisToRediagnose) allRediag.add(u);
    }
    if (needRebuild) await state.refreshConfig();
    for (const uri of allRediag) {
      const doc = documents.get(uri);
      if (doc && !isJsonSidecar(uri)) analyzeAndPublish(doc);
    }
  });

  function debouncedDiagnose(doc: TextDocument): void {
    const existing = debounceTimers.get(doc.uri);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      doc.uri,
      setTimeout(() => {
        debounceTimers.delete(doc.uri);
        analyzeAndPublish(doc);
      }, 150),
    );
  }

  function analyzeAndPublish(doc: TextDocument): void {
    const model = state.documentStore.update(doc.uri, doc.getText());
    state.depGraph.set(doc.uri, model.dependencies);
    const ds = provideDiagnostics(model, {
      fileIndex: state.fileIndex,
      pathFeaturesEnabled: state.pathFeaturesEnabled,
      lookupComponentProps: (k) => state.lookupComponentProps(k),
    });
    connection.sendDiagnostics({
      uri: doc.uri,
      diagnostics: ds.map(
        (d) =>
          ({
            range: d.range,
            severity: lspSeverity(d.severity),
            message: d.message,
            source: d.source,
          }) satisfies LspDiagnostic,
      ),
    });
  }

  documents.listen(connection);
  connection.onShutdown(() => {
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
  });
  connection.listen();
}

function lspSeverity(s: Severity): DiagnosticSeverity {
  switch (s) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'info':
      return DiagnosticSeverity.Information;
    case 'hint':
      return DiagnosticSeverity.Hint;
  }
}

function lspCompletionKind(k: string): CompletionItemKind | undefined {
  return (
    {
      Keyword: CompletionItemKind.Keyword,
      Variable: CompletionItemKind.Variable,
      Function: CompletionItemKind.Function,
      Module: CompletionItemKind.Module,
      File: CompletionItemKind.File,
      Property: CompletionItemKind.Property,
      Value: CompletionItemKind.Value,
    } as Record<string, CompletionItemKind>
  )[k];
}

function toInternalTriggerKind(k: CompletionTriggerKind | undefined): InternalTriggerKind {
  switch (k) {
    case CompletionTriggerKind.TriggerCharacter:
      return 'triggerCharacter';
    case CompletionTriggerKind.TriggerForIncompleteCompletions:
      return 'forIncomplete';
    case CompletionTriggerKind.Invoked:
    default:
      return 'invoked';
  }
}

createServer();
