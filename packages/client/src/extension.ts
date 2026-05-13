import * as path from 'node:path';
import { ExtensionContext, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('..', 'server', 'dist', 'server.cjs'));

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
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
