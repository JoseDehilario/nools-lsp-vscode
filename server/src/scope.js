/**
 * Nools & CTAT Language Server - Scope & Symbol Management
 * Implements hierarchical symbol tables for lexical scoping in Nools rules.
 */

const { isBuiltinSymbol, isBuiltinType } = require('./builtins');

class SymbolEntry {
  constructor(name, kind, range, uri = '', metadata = {}) {
    this.name = name;
    this.kind = kind; // 'global', 'factType', 'function', 'rule', 'alias', 'slotBinding', 'local', 'builtin'
    this.range = range;
    this.uri = uri;
    this.metadata = metadata; // e.g., slots for FactType, params for function
  }
}

class Scope {
  constructor(parent = null, name = 'anonymous') {
    this.parent = parent;
    this.name = name;
    this.symbols = new Map();
  }

  define(symbol) {
    this.symbols.set(symbol.name, symbol);
  }

  resolve(name) {
    if (this.symbols.has(name)) {
      return this.symbols.get(name);
    }
    if (this.parent) {
      return this.parent.resolve(name);
    }
    return null;
  }

  hasLocal(name) {
    return this.symbols.has(name);
  }
}

class ScopeManager {
  constructor() {
    this.rootScope = new Scope(null, 'root_builtins');
    this.initRootBuiltins();
    this.workspaceScope = new Scope(this.rootScope, 'workspace_globals');
    this.fileASTs = new Map(); // uri -> ast
  }

  initRootBuiltins() {
    // Add all Rete, CTAT, and JS builtins
    const { RETE_PRIMITIVES, CTAT_PRIMITIVES, JS_GLOBALS, STANDARD_TYPES } = require('./builtins');

    for (const prim of RETE_PRIMITIVES) {
      this.rootScope.define(new SymbolEntry(prim, 'builtin_rete', null, '', { description: 'Nools Rete Engine Primitive' }));
    }
    for (const ctat of CTAT_PRIMITIVES) {
      this.rootScope.define(new SymbolEntry(ctat, 'builtin_ctat', null, '', { description: 'CTAT Pedagogical / Model Tracer Primitive' }));
    }
    for (const js of JS_GLOBALS) {
      this.rootScope.define(new SymbolEntry(js, 'builtin_js', null, '', { description: 'JavaScript Standard Runtime Global' }));
    }
    for (const type of STANDARD_TYPES) {
      this.rootScope.define(new SymbolEntry(type, 'builtin_type', null, '', { description: 'Standard Value Type' }));
    }
  }

  /**
   * Register or update an entire file's AST into the workspace global symbol table
   */
  updateFile(uri, ast) {
    this.fileASTs.set(uri, ast);
    this.rebuildWorkspaceScope();
  }

  removeFile(uri) {
    this.fileASTs.delete(uri);
    this.rebuildWorkspaceScope();
  }

  rebuildWorkspaceScope() {
    this.workspaceScope = new Scope(this.rootScope, 'workspace_globals');

    for (const [fileUri, ast] of this.fileASTs.entries()) {
      // 1. Globals
      for (const g of ast.globals) {
        this.workspaceScope.define(new SymbolEntry(g.name, 'global', g.nameRange, fileUri, { value: g.value }));
      }

      // 2. Defines / Fact Types
      for (const d of ast.defines) {
        this.workspaceScope.define(new SymbolEntry(d.name, 'factType', d.nameRange, fileUri, {
          slots: d.slots.map(s => s.name),
          slotDetails: d.slots,
          constructorParams: d.constructorParams
        }));
      }

      // 3. Helper Functions
      for (const f of ast.functions) {
        this.workspaceScope.define(new SymbolEntry(f.name, 'function', f.nameRange, fileUri, {
          params: f.params.map(p => p.name)
        }));
      }

      // 4. Production Rules
      for (const r of ast.rules) {
        this.workspaceScope.define(new SymbolEntry(r.name, 'rule', r.nameRange, fileUri, {
          properties: r.properties
        }));
      }
    }
  }

  /**
   * Build a scoped context for a specific rule
   */
  buildRuleScope(rule, uri) {
    const ruleScope = new Scope(this.workspaceScope, `rule_${rule.name}`);

    // Register rule's own name
    ruleScope.define(new SymbolEntry(rule.name, 'rule', rule.nameRange, uri));

    // Register pattern aliases and slot variables from 'when' block
    if (rule.when) {
      for (const pattern of rule.when.patterns) {
        if (pattern.alias) {
          ruleScope.define(new SymbolEntry(
            pattern.alias,
            'alias',
            pattern.aliasRange,
            uri,
            { factType: pattern.factType }
          ));
        }

        // Register slot bindings
        for (const slot of pattern.slots) {
          if (slot.bindingVar) {
            ruleScope.define(new SymbolEntry(
              slot.bindingVar,
              'slotBinding',
              slot.bindingRange,
              uri,
              { factType: pattern.factType, slotName: slot.slotName }
            ));
          }
        }
      }
    }

    // Action scope for 'then' block
    const actionScope = new Scope(ruleScope, `then_${rule.name}`);
    if (rule.then) {
      for (const decl of rule.then.localDeclarations) {
        actionScope.define(new SymbolEntry(
          decl.name,
          'local',
          decl.range,
          uri
        ));
      }
    }

    return {
      ruleScope,
      actionScope
    };
  }

  /**
   * Retrieve fact type metadata if defined
   */
  getFactType(name) {
    const sym = this.workspaceScope.resolve(name);
    if (sym && sym.kind === 'factType') {
      return sym;
    }
    return null;
  }
}

module.exports = {
  SymbolEntry,
  Scope,
  ScopeManager
};
