import * as path from 'node:path';
import { Disposable, ExtensionContext, Position, SnippetString, window, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.cjs'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'liquid' }],
    synchronize: {
      fileEvents: [
        workspace.createFileSystemWatcher('**/vite.config.ts'),
        workspace.createFileSystemWatcher('**/*.liquid'),
        workspace.createFileSystemWatcher('**/*.liquid.json'),
      ],
    },
  };

  client = new LanguageClient('liquidParadox', 'Liquid Paradox', serverOptions, clientOptions);
  const activeClient = client;
  activeClient.start().then(() => activateTagClosing(activeClient, context));
}

/**
 * Auto-closes HTML tags in the HTML regions of `.liquid` files. On insertion of
 * `>` or `/`, asks the server (`liquid/tagClose`) for the matching close-tag
 * snippet and inserts it. The server only answers when the position is in an
 * HTML region, so Liquid delimiters are never affected.
 */
function activateTagClosing(languageClient: LanguageClient, context: ExtensionContext): void {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const disposable = workspace.onDidChangeTextDocument((event) => {
    const document = event.document;
    if (document.languageId !== 'liquid') return;
    if (document !== window.activeTextEditor?.document || event.contentChanges.length === 0) return;

    const lastChange = event.contentChanges[event.contentChanges.length - 1]!;
    const lastCharacter = lastChange.text[lastChange.text.length - 1];
    if (lastChange.rangeLength > 0 || (lastCharacter !== '>' && lastCharacter !== '/')) return;

    const rangeStart = lastChange.range.start;
    const version = document.version;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      // The inserted text may span multiple lines (e.g. a pasted block), so the
      // post-edit cursor position must account for embedded newlines rather than
      // just offsetting the start column by the full inserted length.
      const addedLines = lastChange.text.split(/\r\n|\n/);
      const position =
        addedLines.length <= 1
          ? new Position(rangeStart.line, rangeStart.character + lastChange.text.length)
          : new Position(rangeStart.line + addedLines.length - 1, addedLines[addedLines.length - 1]!.length);
      languageClient
        .sendRequest<string | null>('liquid/tagClose', {
          textDocument: { uri: document.uri.toString() },
          position: { line: position.line, character: position.character },
        })
        .then(
          (snippet) => {
            if (!snippet) return;
            const activeEditor = window.activeTextEditor;
            if (!activeEditor) return;
            const activeDocument = activeEditor.document;
            if (activeDocument !== document || activeDocument.version !== version) return;
            const selections = activeEditor.selections;
            if (selections.length && selections.some((s) => s.active.isEqual(position))) {
              activeEditor.insertSnippet(
                new SnippetString(snippet),
                selections.map((s) => s.active),
              );
            } else {
              activeEditor.insertSnippet(new SnippetString(snippet), position);
            }
          },
          () => {
            /* request failed or server not ready — ignore */
          },
        );
    }, 100);
  });

  context.subscriptions.push(disposable);
  context.subscriptions.push(
    new Disposable(() => {
      if (timeout) clearTimeout(timeout);
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
