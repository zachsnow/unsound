// Unsound VS Code Extension

import * as path from 'path';
import type { ExtensionContext, OutputChannel } from 'vscode';
import { window } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;
let outputChannel: OutputChannel;

export function activate(context: ExtensionContext) {
  outputChannel = window.createOutputChannel('Unsound Language Server');
  outputChannel.appendLine('Extension activating...');

  const serverModule = context.asAbsolutePath(path.join('lsp', 'server.ts'));
  outputChannel.appendLine(`Server module: ${serverModule}`);

  const serverOptions: ServerOptions = {
    run: {
      command: '/Users/z/.bun/bin/bun',
      args: ['run', serverModule, '--stdio'],
      transport: TransportKind.stdio,
    },
    debug: {
      command: '/Users/z/.bun/bin/bun',
      args: ['run', serverModule, '--stdio'],
      transport: TransportKind.stdio,
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'unsound' }],
    outputChannel,
  };

  client = new LanguageClient(
    'unsound',
    'Unsound Language Server',
    serverOptions,
    clientOptions
  );

  outputChannel.appendLine('Starting client...');
  client.start().then(() => {
    outputChannel.appendLine('Client started successfully');
  }).catch((err) => {
    outputChannel.appendLine(`Client failed to start: ${err}`);
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
