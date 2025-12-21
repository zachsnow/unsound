// Unsound VS Code Extension

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ExtensionContext, OutputChannel } from 'vscode';
import { window } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;
let outputChannel: OutputChannel;

// Find usc-language-server - check PATH first, then common locations
function findServer(): string | null {
  const { execSync } = require('child_process');

  // Check if available in PATH (works with bun link, npm install -g, etc.)
  try {
    const result = execSync('which usc-language-server', { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch {}

  // Fallback: check common binary install locations
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'usc-language-server'),
    '/usr/local/bin/usc-language-server',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function activate(context: ExtensionContext) {
  outputChannel = window.createOutputChannel('Unsound Language Server');
  outputChannel.appendLine('Extension activating...');

  const server = findServer();

  let serverOptions: ServerOptions;

  if (server) {
    outputChannel.appendLine(`Found server: ${server}`);
    serverOptions = {
      run: {
        command: server,
        args: ['--stdio'],
        transport: TransportKind.stdio,
      },
      debug: {
        command: server,
        args: ['--stdio'],
        transport: TransportKind.stdio,
      },
    };
  } else {
    // Fallback: try running with bun from extension directory
    outputChannel.appendLine('Server not found in PATH, falling back to bun');
    const serverModule = context.asAbsolutePath(path.join('lsp', 'server.ts'));
    outputChannel.appendLine(`Server module: ${serverModule}`);
    serverOptions = {
      run: {
        command: 'bun',
        args: ['run', serverModule, '--stdio'],
        transport: TransportKind.stdio,
      },
      debug: {
        command: 'bun',
        args: ['run', serverModule, '--stdio'],
        transport: TransportKind.stdio,
      },
    };
  }

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
