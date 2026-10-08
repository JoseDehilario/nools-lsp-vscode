#!/usr/bin/env node
/**
 * Nools & CTAT Language Server - Main Entry Point
 * Implements full Language Server Protocol (LSP 3.17) capabilities.
 */

const { LSPTransport } = require('./protocol');
const { NoolsParser } = require('./parser');
const { ScopeManager } = require('./scope');
const { DiagnosticEngine } = require('./diagnostics');
const { isBuiltinSymbol, isBuiltinType } = require('./builtins');

class NoolsLanguageServer {
  constructor(inputStream = process.stdin, outputStream = process.stdout) {
    this.transport = new LSPTransport(inputStream, outputStream);
    this.scopeManager = new ScopeManager();
    this.diagnosticEngine = new DiagnosticEngine(this.scopeManager);
    this.documents = new Map(); // uri -> { text, version, ast }

    this.registerHandlers();
  }

  registerHandlers() {
    // 1. Initialize
    this.transport.onRequest('initialize', params => this.handleInitialize(params));
    this.transport.onNotification('initialized', () => {
      // Server initialized successfully
    });

    // 2. Document Synchronization
    this.transport.onNotification('textDocument/didOpen', params => this.handleDidOpen(params));
    this.transport.onNotification('textDocument/didChange', params => this.handleDidChange(params));
    this.transport.onNotification('textDocument/didClose', params => this.handleDidClose(params));

    // 3. Language Intelligence Features
    this.transport.onRequest('textDocument/hover', params => this.handleHover(params));
    this.transport.onRequest('textDocument/definition', params => this.handleDefinition(params));
    this.transport.onRequest('textDocument/documentSymbol', params => this.handleDocumentSymbol(params));
    this.transport.onRequest('textDocument/completion', params => this.handleCompletion(params));
  }

  handleInitialize(params) {
    return {
      capabilities: {
        textDocumentSync: 1, // Full document synchronization
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        completionProvider: {
          resolveProvider: false,
          triggerCharacters: ['.', ':']
        }
      },
      serverInfo: {
        name: 'nools-language-server',
        version: '1.0.0'
      }
    };
  }

  handleDidOpen(params) {
    const { textDocument } = params;
    this.processDocument(textDocument.uri, textDocument.text);
  }

  handleDidChange(params) {
    const { textDocument, contentChanges } = params;
    if (contentChanges.length > 0) {
      // Since sync kind is 1 (Full), the last change contains full text
      const fullText = contentChanges[contentChanges.length - 1].text;
      this.processDocument(textDocument.uri, fullText);
    }
  }

  handleDidClose(params) {
    const { textDocument } = params;
    this.documents.delete(textDocument.uri);
    this.scopeManager.removeFile(textDocument.uri);

    // Clear diagnostics on close
    this.transport.sendNotification('textDocument/publishDiagnostics', {
      uri: textDocument.uri,
      diagnostics: []
    });
  }

  processDocument(uri, text) {
    const parser = new NoolsParser(text, uri);
    const ast = parser.parse();

    this.documents.set(uri, { text, ast });
    this.scopeManager.updateFile(uri, ast);

    // Run semantic validation
    const diagnostics = this.diagnosticEngine.validate(ast);

    this.transport.sendNotification('textDocument/publishDiagnostics', {
      uri,
      diagnostics
    });
  }

  handleHover(params) {
    const { textDocument, position } = params;
    const doc = this.documents.get(textDocument.uri);
    if (!doc) return null;

    const ast = doc.ast;
    const line = position.line;
    const character = position.character;

    // Check if hovering over a rule
    for (const rule of ast.rules) {
      if (this.isPositionInside(position, rule.nameRange)) {
        return {
          contents: {
            kind: 'markdown',
            value: `**Rule**: \`${rule.name}\`\n\n*Properties*: salience: \`${rule.properties.salience || 0}\`, agenda-group: \`${rule.properties['agenda-group'] || 'default'}\``
          }
        };
      }

      // Check LHS pattern aliases
      if (rule.when) {
        for (const pattern of rule.when.patterns) {
          if (pattern.aliasRange && this.isPositionInside(position, pattern.aliasRange)) {
            return {
              contents: {
                kind: 'markdown',
                value: `*(pattern alias)* **\`${pattern.alias}\`**: \`${pattern.factType}\`\n\nBound in rule \`${rule.name}\` when clause.`
              }
            };
          }
          if (pattern.factTypeRange && this.isPositionInside(position, pattern.factTypeRange)) {
            const factType = this.scopeManager.getFactType(pattern.factType);
            const slotsStr = factType ? factType.metadata.slots.join(', ') : 'no declared slots';
            return {
              contents: {
                kind: 'markdown',
                value: `*(fact type)* **\`${pattern.factType}\`**\n\nDeclared slots: \`[${slotsStr}]\``
              }
            };
          }
        }
      }

      // Check RHS identifiers
      if (rule.then) {
        for (const ident of rule.then.identifiersUsed) {
          if (this.isPositionInside(position, ident.range)) {
            const { actionScope } = this.scopeManager.buildRuleScope(rule, textDocument.uri);
            const sym = actionScope.resolve(ident.name);
            if (sym) {
              return {
                contents: {
                  kind: 'markdown',
                  value: `*(${sym.kind})* **\`${sym.name}\`**\n\n${sym.metadata.description || 'Resolved in Nools rule scope'}`
                }
              };
            }
          }
        }
      }
    }

    // Check globals
    for (const g of ast.globals) {
      if (this.isPositionInside(position, g.nameRange)) {
        return {
          contents: {
            kind: 'markdown',
            value: `*(global variable)* **\`${g.name}\`** = \`${g.value || 'undefined'}\``
          }
        };
      }
    }

    // Check fact types
    for (const d of ast.defines) {
      if (this.isPositionInside(position, d.nameRange)) {
        const slots = d.slots.map(s => s.name).join(', ');
        return {
          contents: {
            kind: 'markdown',
            value: `*(fact type definition)* **\`${d.name}\`**\n\nSlots: \`[${slots}]\``
          }
        };
      }
    }

    return null;
  }

  handleDefinition(params) {
    const { textDocument, position } = params;
    const doc = this.documents.get(textDocument.uri);
    if (!doc) return null;

    const ast = doc.ast;

    for (const rule of ast.rules) {
      // If clicking on factType in pattern -> go to define
      if (rule.when) {
        for (const pattern of rule.when.patterns) {
          if (pattern.factTypeRange && this.isPositionInside(position, pattern.factTypeRange)) {
            const factType = this.scopeManager.getFactType(pattern.factType);
            if (factType && factType.range) {
              return {
                uri: factType.uri,
                range: factType.range
              };
            }
          }
        }
      }

      // If clicking on an identifier in then block -> go to alias or local decl
      if (rule.then) {
        for (const ident of rule.then.identifiersUsed) {
          if (this.isPositionInside(position, ident.range)) {
            const { actionScope } = this.scopeManager.buildRuleScope(rule, textDocument.uri);
            const sym = actionScope.resolve(ident.name);
            if (sym && sym.range) {
              return {
                uri: sym.uri,
                range: sym.range
              };
            }
          }
        }
      }
    }

    return null;
  }

  handleDocumentSymbol(params) {
    const { textDocument } = params;
    const doc = this.documents.get(textDocument.uri);
    if (!doc) return [];

    const ast = doc.ast;
    const symbols = [];

    // SymbolKind: File=1, Module=2, Namespace=3, Package=4, Class=5, Method=6, Property=7, Field=8, Constructor=9, Enum=10, Interface=11, Function=12, Variable=13, Constant=14

    for (const g of ast.globals) {
      symbols.push({
        name: g.name,
        kind: 14, // Constant / Global
        range: g.range,
        selectionRange: g.nameRange
      });
    }

    for (const d of ast.defines) {
      symbols.push({
        name: d.name,
        kind: 5, // Class / Fact Type
        range: d.range,
        selectionRange: d.nameRange
      });
    }

    for (const f of ast.functions) {
      symbols.push({
        name: f.name,
        kind: 12, // Function
        range: f.range,
        selectionRange: f.nameRange
      });
    }

    for (const r of ast.rules) {
      symbols.push({
        name: r.name,
        kind: 6, // Method / Rule
        range: r.range,
        selectionRange: r.nameRange
      });
    }

    return symbols;
  }

  handleCompletion(params) {
    const completions = [];

    // 1. Suggest CTAT and Rete primitives
    const { RETE_PRIMITIVES, CTAT_PRIMITIVES } = require('./builtins');
    for (const prim of RETE_PRIMITIVES) {
      completions.push({
        label: prim,
        kind: 3, // Function
        detail: 'Nools Rete Primitive',
        insertText: `${prim}($0);`
      });
    }
    for (const ctat of CTAT_PRIMITIVES) {
      completions.push({
        label: ctat,
        kind: 3, // Function
        detail: 'CTAT Model Tracer Primitive'
      });
    }

    // 2. Suggest known fact types
    for (const [uri, ast] of this.documents.entries()) {
      for (const d of ast.defines) {
        completions.push({
          label: d.name,
          kind: 7, // Class
          detail: `Fact Type (${d.slots.length} slots)`
        });
      }
      for (const g of ast.globals) {
        completions.push({
          label: g.name,
          kind: 6, // Variable
          detail: 'Global Variable'
        });
      }
    }

    return completions;
  }

  isPositionInside(pos, range) {
    if (!range) return false;
    if (pos.line < range.start.line || pos.line > range.end.line) return false;
    if (pos.line === range.start.line && pos.character < range.start.character) return false;
    if (pos.line === range.end.line && pos.character > range.end.character) return false;
    return true;
  }
}

// If invoked as standalone executable, launch the server
if (require.main === module) {
  new NoolsLanguageServer();
}

module.exports = {
  NoolsLanguageServer
};
