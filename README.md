# Nools Language Support & Semantic Linter for Visual Studio Code

A specialized Language Server Protocol (LSP) extension designed for the **Nools** rule engine domain-specific language (DSL), specifically tailored for cognitive tutor modeling workflows with **CMU's Cognitive Tutor Authoring Tools (CTAT)**.

---

## Features

- **Semantic Diagnostics & Undefined Term Detection**:
  - **Undefined Fact Types**: Flags instances where a pattern or `new Type(...)` references a fact type not declared in `define` or imported.
  - **Undefined Pattern Aliases**: Flags RHS references to aliases that were never bound in the `when` clause (e.g. calling `modify(prob, ...)` instead of `modify(p, ...)`).
  - **Undefined Local / Global Variables**: Catches variables used in RHS action blocks without `let`, `const`, `var`, or a top-level `global` declaration.
  - **Undefined Slot Names**: Warns when LHS constraints reference slots not declared in the fact type's schema definition.
  - **Duplicate Definitions**: Flags duplicate rule names and duplicate fact type definitions.
- **CTAT Pedagogical Primitives Recognition**:
  - Native recognition of `checkSAI()`, `predictSAI()`, `backtrack()`, `setCustomField()`, `setSuccessOrFeedback()`, `setSuccessOrCommFailure()`, `assert()`, `modify()`, `retract()`, and `halt()`.
  - Console inspection tools: `printAgenda()`, `printFacts()`, `printRules()`, `printConflictTree()`.
- **Syntax Highlighting (TextMate)**:
  - Full syntax highlighting for `.nools` files: keywords (`rule`, `when`, `then`, `define`, `global`, `function`, `import`), metadata properties (`salience`, `agenda-group`), pattern aliases, operators, and comments.
- **Language Intelligence**:
  - **Hover**: Rich markdown documentation on rules, pattern aliases, fact types, and global variables.
  - **Go to Definition**: Jump from RHS identifier usage to LHS pattern bindings or fact type definitions.
  - **Document Symbols / Outline**: Full code outline displaying all rules, fact types, helper functions, and globals.

---

## Directory Structure

```
vscode-nools-lsp/
├── package.json                   # Extension manifest registering language and LSP client
├── language-configuration.json    # Comments, bracket matching, and auto-closing pairs
├── syntaxes/
│   └── nools.tmLanguage.json      # TextMate syntax highlighting grammar
├── client/
│   └── src/
│       └── extension.js           # Client entry point launching language server via stdio
├── server/
│   └── src/
│       ├── builtins.js            # Catalog of Rete, CTAT, and JS runtime symbols
│       ├── parser.js              # Tokenizer & AST Parser for Nools DSL
│       ├── scope.js               # Multi-tier Lexical Scope and Symbol Table
│       ├── diagnostics.js         # Semantic diagnostic validator for undefined terms
│       ├── protocol.js            # JSON-RPC 2.0 LSP transport layer
│       └── server.js              # Main Language Server process
└── test/
    ├── test-samples/              # Test corpus (.nools files)
    └── run-tests.js               # Automated test suite
```

---

## Running the Automated Test Suite

To verify the parser, scoping, diagnostics, and LSP protocol:

```bash
cd vscode-nools-lsp
node test/run-tests.js
```

---

## How It Works

1. **Outer DSL Tokenization**: The server parses the outer Nools structure (`import`, `global`, `define`, `rule`, `when`, `then`).
2. **LHS Pattern Extraction**: Extracts fact types, pattern aliases (e.g. `p : Problem`), slot constraints (`{ subgoals: sgList }`), and condition expressions.
3. **Multi-tier Lexical Scoping**: Builds a tree of symbol tables:
   $$\text{Root Built-ins (CTAT/Rete/JS)} \rightarrow \text{Workspace Globals} \rightarrow \text{Rule Scope} \rightarrow \text{LHS Aliases} \rightarrow \text{RHS Action Locals}$$
4. **Diagnostic Emission**: Cross-references every identifier against the active scope chain. Unresolved identifiers trigger LSP `Diagnostic` alerts directly into the VS Code Problems panel and editor squiggly underlines.
