/**
 * Nools & CTAT Language Server - Diagnostic Engine
 * Generates semantic alerts for undefined terms, scoping violations, and syntax issues.
 */

const { isBuiltinType, isBuiltinSymbol } = require('./builtins');

const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4
};

class DiagnosticEngine {
  constructor(scopeManager) {
    this.scopeManager = scopeManager;
  }

  /**
   * Validate a single document AST and produce LSP Diagnostics
   */
  validate(ast) {
    const diagnostics = [];
    const uri = ast.uri;

    // 1. Check for Duplicate Top-Level Declarations within the file
    this.checkDuplicates(ast, diagnostics);

    // 2. Validate Fact Types, Rules, and Scopes
    for (const rule of ast.rules) {
      this.validateRule(rule, uri, diagnostics);
    }

    return diagnostics;
  }

  checkDuplicates(ast, diagnostics) {
    const seenDefines = new Map();
    for (const d of ast.defines) {
      if (seenDefines.has(d.name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: d.nameRange,
          message: `Duplicate fact type definition '${d.name}'. Fact types must be uniquely defined.`,
          source: 'nools-lsp'
        });
      } else {
        seenDefines.set(d.name, d);
      }
    }

    const seenGlobals = new Map();
    for (const g of ast.globals) {
      if (seenGlobals.has(g.name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: g.nameRange,
          message: `Duplicate global variable declaration '${g.name}'.`,
          source: 'nools-lsp'
        });
      } else {
        seenGlobals.set(g.name, g);
      }
    }

    const seenRules = new Map();
    for (const r of ast.rules) {
      if (seenRules.has(r.name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: r.nameRange,
          message: `Duplicate rule definition '${r.name}'. Production rule names must be unique.`,
          source: 'nools-lsp'
        });
      } else {
        seenRules.set(r.name, r);
      }
    }
  }

  validateRule(rule, uri, diagnostics) {
    const { ruleScope, actionScope } = this.scopeManager.buildRuleScope(rule, uri);

    // Validate LHS (when block)
    if (rule.when) {
      for (const pattern of rule.when.patterns) {
        // A. Validate Fact Type existence
        if (pattern.factType) {
          const typeSymbol = this.scopeManager.workspaceScope.resolve(pattern.factType);
          const isStandard = isBuiltinType(pattern.factType);

          if (!typeSymbol && !isStandard) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: pattern.factTypeRange || rule.nameRange,
              message: `Undefined fact type '${pattern.factType}'. Ensure it is defined via 'define ${pattern.factType} { ... }' or imported.`,
              source: 'nools-lsp',
              code: 'undefined-fact-type'
            });
          }

          // B. Validate Slot Names against schema if fact type is defined
          if (typeSymbol && typeSymbol.metadata && typeSymbol.metadata.slots) {
            const knownSlots = typeSymbol.metadata.slots;
            for (const slot of pattern.slots) {
              if (knownSlots.length > 0 && !knownSlots.includes(slot.slotName)) {
                diagnostics.push({
                  severity: DiagnosticSeverity.Warning,
                  range: slot.slotRange,
                  message: `Slot '${slot.slotName}' is not declared in fact type '${pattern.factType}'. Known slots: [${knownSlots.join(', ')}].`,
                  source: 'nools-lsp',
                  code: 'undefined-slot-name'
                });
              }
            }
          }
        }

        // C. Validate identifiers used in pattern condition expressions
        for (const ident of pattern.identifiersUsed) {
          // If identifier matches current pattern alias, it's valid
          if (pattern.alias && ident.name === pattern.alias) {
            continue;
          }

          const resolved = ruleScope.resolve(ident.name);
          if (!resolved) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: ident.range,
              message: `Undefined term '${ident.name}' in rule condition. It has not been defined as an alias, slot variable, or global.`,
              source: 'nools-lsp',
              code: 'undefined-condition-term'
            });
          }
        }
      }
    }

    // Validate RHS (then block)
    if (rule.then) {
      for (const ident of rule.then.identifiersUsed) {
        const resolved = actionScope.resolve(ident.name);

        if (!resolved) {
          // Check if it was an alias in when that might have been misspelled
          let hintMessage = `Undefined term '${ident.name}'. No variable, pattern alias, or global is defined with this name.`;

          // If there's a defined alias in when that resembles this name
          if (rule.when) {
            const definedAliases = rule.when.patterns.map(p => p.alias).filter(Boolean);
            if (definedAliases.length > 0) {
              hintMessage += ` Available aliases in rule '${rule.name}': [${definedAliases.join(', ')}].`;
            }
          }

          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: ident.range,
            message: hintMessage,
            source: 'nools-lsp',
            code: 'undefined-action-term'
          });
        }
      }
    }
  }
}

module.exports = {
  DiagnosticSeverity,
  DiagnosticEngine
};
