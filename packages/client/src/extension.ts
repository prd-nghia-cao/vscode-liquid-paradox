import * as path from 'node:path';
import { ExtensionContext, workspace } from 'vscode';
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
    documentSelector: [
      { scheme: 'file', language: 'liquid' },
      // `.liquid.json` sidecars are synced so media keys (`image.src`,
      // `videoSrc`, …) can offer assets. The pattern keeps ordinary JSON out.
      { scheme: 'file', language: 'json', pattern: '**/*.liquid.json' },
      { scheme: 'file', language: 'jsonc', pattern: '**/*.liquid.json' },
    ],
    synchronize: {
      fileEvents: [
        workspace.createFileSystemWatcher('**/vite.config.ts'),
        workspace.createFileSystemWatcher('**/*.liquid'),
        workspace.createFileSystemWatcher('**/*.liquid.json'),
      ],
    },
  };

  client = new LanguageClient('liquidParadox', 'Liquid Paradox', serverOptions, clientOptions);
  context.subscriptions.push(client);
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
