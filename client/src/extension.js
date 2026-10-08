/**
 * Nools & CTAT Language Server - VS Code Client Entry Point
 * Spawns and manages the Nools Language Server process upon opening .nools files.
 */

const path = require('path');

let client;

function activate(context) {
  // If vscode is available (running inside VS Code Extension Host)
  let vscode;
  try {
    vscode = require('vscode');
  } catch (e) {
    // In headless testing or development environments
    console.log('Running outside VS Code host.');
    return;
  }

  const serverModule = context.asAbsolutePath(
    path.join('server', 'src', 'server.js')
  );

  // Server debug options (enables --inspect when debugging extension)
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  const serverOptions = {
    run: { module: serverModule, transport: 0 /* Stdio */ },
    debug: {
      module: serverModule,
      transport: 0 /* Stdio */,
      options: debugOptions
    }
  };

  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'nools' }],
    synchronize: {
      // Notify the server about file changes to .nools files in workspace
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.nools')
    }
  };

  // Dynamically load vscode-languageclient if installed, or log fallback
  try {
    const { LanguageClient } = require('vscode-languageclient/node');
    client = new LanguageClient(
      'noolsLanguageServer',
      'Nools Language Server',
      serverOptions,
      clientOptions
    );

    client.start();
    console.log('Nools Language Server successfully started.');
  } catch (err) {
    console.warn('vscode-languageclient package not yet bundled. Run npm install or use packaged VSIX.', err.message);
  }
}

function deactivate() {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

module.exports = {
  activate,
  deactivate
};
