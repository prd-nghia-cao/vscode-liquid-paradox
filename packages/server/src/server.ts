import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
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
import { buildWatcherRegistrations } from './workspace/watchers.js';
import { provideCompletions } from './providers/completion.js';
import { provideHover } from './providers/hover.js';
import { provideDefinition } from './providers/definition.js';
import { provideDiagnostics, type Severity } from './providers/diagnostics.js';
import { routeFileEvent } from './workspace/watchers.js';

export function createServer(): void {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  let workspaceRoot: string | undefined;
  let state = createServerState({
    readVite: () => {
      if (!workspaceRoot) return undefined;
      const p = path.join(workspaceRoot, 'vite.config.ts');
      try {
        return { text: fs.readFileSync(p, 'utf8'), repoRoot: workspaceRoot };
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
  });

  const debounceTimers = new Map<string, NodeJS.Timeout>();

  connection.onInitialize((params): InitializeResult => {
    workspaceRoot = params.rootUri
      ? params.rootUri.replace('file://', '')
      : (params.workspaceFolders?.[0]?.uri.replace('file://', '') ?? process.cwd());
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ['{', '%', '|', '"', "'", '.', ','] },
        hoverProvider: true,
        definitionProvider: true,
      },
    };
  });

  connection.onInitialized(async () => {
    await state.refreshConfig();
    if (state.dirs) {
      const regs = buildWatcherRegistrations(state.dirs);
      await connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: regs.map((r) => ({ globPattern: r.globPattern })),
      });
    }
    for (const doc of documents.all()) {
      analyzeAndPublish(doc);
    }
  });

  documents.onDidOpen((e) => analyzeAndPublish(e.document));
  documents.onDidChangeContent((e) => debouncedDiagnose(e.document));
  documents.onDidClose((e) => {
    state.documentStore.remove(e.document.uri);
    state.depGraph.remove(e.document.uri);
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const model =
      state.documentStore.get(params.textDocument.uri) ?? state.documentStore.update(doc.uri, doc.getText());
    const items = provideCompletions(model, params.position, {
      fileIndex: state.fileIndex,
      lookupComponentProps: (k) => state.lookupComponentProps(k),
    });
    return items.map(
      (i) =>
        ({
          label: i.label,
          kind: lspCompletionKind(i.kind),
          detail: i.detail,
          documentation: i.documentation,
        }) satisfies LspCompletionItem,
    );
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const model =
      state.documentStore.get(params.textDocument.uri) ?? state.documentStore.update(doc.uri, doc.getText());
    const h = provideHover(model, params.position, { fileIndex: state.fileIndex });
    if (!h) return null;
    return { contents: { kind: 'markdown', value: h.markdown }, range: h.range };
  });

  connection.onDefinition((params): Definition | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const model =
      state.documentStore.get(params.textDocument.uri) ?? state.documentStore.update(doc.uri, doc.getText());
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
      for (const u of out.urisToRediagnose) allRediag.add(u);
    }
    if (needRebuild) await state.refreshConfig();
    for (const uri of allRediag) {
      const doc = documents.get(uri);
      if (doc) analyzeAndPublish(doc);
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
    } as Record<string, CompletionItemKind>
  )[k];
}

createServer();
