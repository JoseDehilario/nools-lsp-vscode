/**
 * Nools & CTAT Language Server - Lexer & AST Parser
 * Resilient parser for Nools DSL files with embedded JavaScript analysis.
 */

class Position {
  constructor(line, character) {
    this.line = line; // 0-indexed
    this.character = character; // 0-indexed
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class Token {
  constructor(type, value, start, end, startIndex, endIndex) {
    this.type = type;
    this.value = value;
    this.start = start;
    this.end = end;
    this.startIndex = startIndex;
    this.endIndex = endIndex;
  }
}

class NoolsParser {
  constructor(text, uri = '') {
    this.text = text;
    this.uri = uri;
    this.lineOffsets = this.computeLineOffsets(text);
  }

  computeLineOffsets(text) {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  offsetToPosition(offset) {
    let low = 0;
    let high = this.lineOffsets.length - 1;
    let line = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.lineOffsets[mid] <= offset) {
        line = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const character = offset - this.lineOffsets[line];
    return new Position(line, character);
  }

  createRange(startOffset, endOffset) {
    return new Range(
      this.offsetToPosition(startOffset),
      this.offsetToPosition(endOffset)
    );
  }

  /**
   * Tokenize input stripping or marking comments and strings
   */
  tokenize() {
    const tokens = [];
    const text = this.text;
    const len = text.length;
    let i = 0;

    while (i < len) {
      const char = text[i];

      // Whitespace
      if (/\s/.test(char)) {
        i++;
        continue;
      }

      // Single line comment
      if (char === '/' && text[i + 1] === '/') {
        const start = i;
        i += 2;
        while (i < len && text[i] !== '\n') i++;
        tokens.push(new Token('COMMENT', text.slice(start, i), this.offsetToPosition(start), this.offsetToPosition(i), start, i));
        continue;
      }

      // Multi-line comment
      if (char === '/' && text[i + 1] === '*') {
        const start = i;
        i += 2;
        while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
        if (i < len) i += 2;
        tokens.push(new Token('COMMENT', text.slice(start, i), this.offsetToPosition(start), this.offsetToPosition(i), start, i));
        continue;
      }

      // Strings (single, double, or template)
      if (char === '"' || char === "'" || char === '`') {
        const quote = char;
        const start = i;
        i++;
        while (i < len && text[i] !== quote) {
          if (text[i] === '\\' && i + 1 < len) {
            i += 2;
          } else {
            i++;
          }
        }
        if (i < len) i++; // consume closing quote
        tokens.push(new Token('STRING', text.slice(start, i), this.offsetToPosition(start), this.offsetToPosition(i), start, i));
        continue;
      }

      // Numbers
      if (/\d/.test(char)) {
        const start = i;
        while (i < len && /[\d\.eE\-]/.test(text[i])) i++;
        tokens.push(new Token('NUMBER', text.slice(start, i), this.offsetToPosition(start), this.offsetToPosition(i), start, i));
        continue;
      }

      // Identifiers or Keywords
      if (/[a-zA-Z_\$]/.test(char)) {
        const start = i;
        while (i < len && /[a-zA-Z0-9_\$]/.test(text[i])) i++;
        const val = text.slice(start, i);
        tokens.push(new Token('IDENTIFIER', val, this.offsetToPosition(start), this.offsetToPosition(i), start, i));
        continue;
      }

      // Symbols / Punctuation
      const start = i;
      i++;
      tokens.push(new Token('PUNCTUATION', char, this.offsetToPosition(start), this.offsetToPosition(i), start, i));
    }

    return tokens;
  }

  /**
   * Main AST Parser entry point
   */
  parse() {
    const ast = {
      uri: this.uri,
      imports: [],
      globals: [],
      defines: [],
      functions: [],
      rules: [],
      syntaxErrors: []
    };

    const tokens = this.tokenize().filter(t => t.type !== 'COMMENT');
    let idx = 0;

    const peek = (offset = 0) => tokens[idx + offset];
    const consume = () => tokens[idx++];

    while (idx < tokens.length) {
      const tok = peek();

      if (!tok) break;

      // 1. import("...")
      if (tok.type === 'IDENTIFIER' && tok.value === 'import') {
        const importDecl = this.parseImport(tokens, idx);
        if (importDecl) {
          ast.imports.push(importDecl.node);
          idx = importDecl.nextIndex;
          continue;
        }
      }

      // 2. global <Name> = <Expr>;
      if (tok.type === 'IDENTIFIER' && tok.value === 'global') {
        const globalDecl = this.parseGlobal(tokens, idx);
        if (globalDecl) {
          ast.globals.push(globalDecl.node);
          idx = globalDecl.nextIndex;
          continue;
        }
      }

      // 3. define <TypeName> { ... }
      if (tok.type === 'IDENTIFIER' && tok.value === 'define') {
        const defineDecl = this.parseDefine(tokens, idx);
        if (defineDecl) {
          ast.defines.push(defineDecl.node);
          idx = defineDecl.nextIndex;
          continue;
        }
      }

      // 4. function <Name>(...) { ... }
      if (tok.type === 'IDENTIFIER' && tok.value === 'function') {
        const funcDecl = this.parseFunction(tokens, idx);
        if (funcDecl) {
          ast.functions.push(funcDecl.node);
          idx = funcDecl.nextIndex;
          continue;
        }
      }

      // 5. rule <RuleName> { ... }
      if (tok.type === 'IDENTIFIER' && tok.value === 'rule') {
        const ruleDecl = this.parseRule(tokens, idx);
        if (ruleDecl) {
          ast.rules.push(ruleDecl.node);
          idx = ruleDecl.nextIndex;
          continue;
        }
      }

      // Unrecognized top-level token, skip
      idx++;
    }

    return ast;
  }

  parseImport(tokens, startIndex) {
    let i = startIndex + 1;
    if (tokens[i] && tokens[i].value === '(') {
      i++;
      if (tokens[i] && tokens[i].type === 'STRING') {
        const raw = tokens[i].value;
        const cleanPath = raw.slice(1, -1);
        const pathTok = tokens[i];
        i++;
        if (tokens[i] && tokens[i].value === ')') i++;
        if (tokens[i] && tokens[i].value === ';') i++;
        return {
          node: {
            path: cleanPath,
            range: new Range(tokens[startIndex].start, tokens[i - 1].end),
            pathRange: pathTok.start && new Range(pathTok.start, pathTok.end)
          },
          nextIndex: i
        };
      }
    }
    return null;
  }

  parseGlobal(tokens, startIndex) {
    let i = startIndex + 1;
    if (tokens[i] && tokens[i].type === 'IDENTIFIER') {
      const nameTok = tokens[i];
      i++;
      let valueExpr = '';
      let valueStart = null;
      let valueEnd = null;

      if (tokens[i] && tokens[i].value === '=') {
        i++;
        valueStart = tokens[i] ? tokens[i].start : nameTok.end;
        // Collect until semicolon or next declaration keyword
        while (i < tokens.length && tokens[i].value !== ';') {
          if (['rule', 'define', 'global', 'function', 'import'].includes(tokens[i].value)) {
            break;
          }
          valueExpr += tokens[i].value + ' ';
          valueEnd = tokens[i].end;
          i++;
        }
        if (tokens[i] && tokens[i].value === ';') {
          valueEnd = tokens[i].end;
          i++;
        }
      }

      return {
        node: {
          name: nameTok.value,
          nameRange: new Range(nameTok.start, nameTok.end),
          range: new Range(tokens[startIndex].start, valueEnd || nameTok.end),
          value: valueExpr.trim()
        },
        nextIndex: i
      };
    }
    return null;
  }

  parseDefine(tokens, startIndex) {
    let i = startIndex + 1;
    if (tokens[i] && tokens[i].type === 'IDENTIFIER') {
      const nameTok = tokens[i];
      i++;
      if (tokens[i] && tokens[i].value === '{') {
        const braceOpenIndex = i;
        i++;
        let depth = 1;
        const slots = [];
        let constructorParams = [];

        while (i < tokens.length && depth > 0) {
          const tok = tokens[i];
          if (tok.value === '{') depth++;
          else if (tok.value === '}') depth--;

          // At top level of define body (depth === 1)
          if (depth === 1 && tok.type === 'IDENTIFIER' && tokens[i + 1] && tokens[i + 1].value === ':') {
            const slotName = tok.value;
            const slotRange = new Range(tok.start, tok.end);
            if (slotName === 'constructor') {
              // Extract constructor parameters if function(...)
              let ci = i + 2;
              if (tokens[ci] && tokens[ci].value === 'function') {
                ci++;
                if (tokens[ci] && tokens[ci].value === '(') {
                  ci++;
                  while (ci < tokens.length && tokens[ci].value !== ')') {
                    if (tokens[ci].type === 'IDENTIFIER') {
                      constructorParams.push({
                        name: tokens[ci].value,
                        range: new Range(tokens[ci].start, tokens[ci].end)
                      });
                    }
                    ci++;
                  }
                }
              }
            } else {
              slots.push({
                name: slotName,
                range: slotRange
              });
            }
          }
          i++;
        }

        return {
          node: {
            name: nameTok.value,
            nameRange: new Range(nameTok.start, nameTok.end),
            range: new Range(tokens[startIndex].start, tokens[i - 1].end),
            slots,
            constructorParams
          },
          nextIndex: i
        };
      }
    }
    return null;
  }

  parseFunction(tokens, startIndex) {
    let i = startIndex + 1;
    if (tokens[i] && tokens[i].type === 'IDENTIFIER') {
      const nameTok = tokens[i];
      i++;
      const params = [];

      if (tokens[i] && tokens[i].value === '(') {
        i++;
        while (i < tokens.length && tokens[i].value !== ')') {
          if (tokens[i].type === 'IDENTIFIER') {
            params.push({
              name: tokens[i].value,
              range: new Range(tokens[i].start, tokens[i].end)
            });
          }
          i++;
        }
        if (tokens[i] && tokens[i].value === ')') i++;
      }

      if (tokens[i] && tokens[i].value === '{') {
        let depth = 1;
        const bodyStart = tokens[i].start;
        i++;
        while (i < tokens.length && depth > 0) {
          if (tokens[i].value === '{') depth++;
          else if (tokens[i].value === '}') depth--;
          i++;
        }
        return {
          node: {
            name: nameTok.value,
            nameRange: new Range(nameTok.start, nameTok.end),
            params,
            range: new Range(tokens[startIndex].start, tokens[i - 1].end)
          },
          nextIndex: i
        };
      }
    }
    return null;
  }

  parseRule(tokens, startIndex) {
    let i = startIndex + 1;
    if (!tokens[i] || tokens[i].type !== 'IDENTIFIER') return null;

    const nameTok = tokens[i];
    i++;

    if (!tokens[i] || tokens[i].value !== '{') return null;
    const ruleStartTok = tokens[startIndex];
    i++; // consume rule '{'

    const ruleNode = {
      name: nameTok.value,
      nameRange: new Range(nameTok.start, nameTok.end),
      range: null,
      properties: {},
      when: null,
      then: null
    };

    let depth = 1;

    while (i < tokens.length && depth > 0) {
      const tok = tokens[i];

      if (depth === 1) {
        // Properties like salience: 10, agenda-group: "..."
        if (tok.type === 'IDENTIFIER' && tokens[i + 1] && tokens[i + 1].value === ':') {
          const propName = tok.value;
          const valTok = tokens[i + 2];
          if (valTok) {
            ruleNode.properties[propName] = valTok.value;
          }
          i += 2;
          continue;
        }

        // 'when' block
        if (tok.type === 'IDENTIFIER' && tok.value === 'when' && tokens[i + 1] && tokens[i + 1].value === '{') {
          const whenStartTok = tok;
          i += 2; // skip when and '{'
          let whenDepth = 1;
          const whenTokens = [];
          const whenStartOffset = tokens[i - 1].startIndex + 1;

          while (i < tokens.length && whenDepth > 0) {
            if (tokens[i].value === '{') whenDepth++;
            else if (tokens[i].value === '}') whenDepth--;
            if (whenDepth > 0) {
              whenTokens.push(tokens[i]);
            }
            i++;
          }

          const whenEndOffset = tokens[i - 1].endIndex - 1;
          const whenRange = new Range(whenStartTok.start, tokens[i - 1].end);
          ruleNode.when = this.parseWhenBlock(whenTokens, whenRange, whenStartOffset, whenEndOffset);
          continue;
        }

        // 'then' block
        if (tok.type === 'IDENTIFIER' && tok.value === 'then' && tokens[i + 1] && tokens[i + 1].value === '{') {
          const thenStartTok = tok;
          const openBrace = tokens[i + 1];
          i += 2; // skip then and '{'
          let thenDepth = 1;
          const thenTokens = [];
          const thenStartOffset = openBrace.endIndex;

          while (i < tokens.length && thenDepth > 0) {
            if (tokens[i].value === '{') thenDepth++;
            else if (tokens[i].value === '}') thenDepth--;
            if (thenDepth > 0) {
              thenTokens.push(tokens[i]);
            }
            i++;
          }

          const closeBrace = tokens[i - 1];
          const thenEndOffset = closeBrace.startIndex;
          const thenRange = new Range(thenStartTok.start, closeBrace.end);
          const thenRawText = this.text.slice(thenStartOffset, thenEndOffset);

          ruleNode.then = this.parseThenBlock(thenTokens, thenRange, thenRawText, thenStartOffset);
          continue;
        }
      }

      if (tok.value === '{') depth++;
      else if (tok.value === '}') depth--;

      i++;
    }

    ruleNode.range = new Range(ruleStartTok.start, tokens[i - 1].end);
    return {
      node: ruleNode,
      nextIndex: i
    };
  }

  /**
   * Parse patterns within a rule's when { ... } block
   */
  parseWhenBlock(tokens, whenRange, startOffset, endOffset) {
    const whenNode = {
      range: whenRange,
      patterns: [],
      rawText: this.text.slice(startOffset, endOffset)
    };

    let pIdx = 0;
    while (pIdx < tokens.length) {
      const tok = tokens[pIdx];

      // Pattern format 1: alias : FactType [from expr] [condition] [ { slot: binding } ] ;
      if (tok.type === 'IDENTIFIER' && tokens[pIdx + 1] && tokens[pIdx + 1].value === ':') {
        const aliasTok = tok;
        pIdx += 2; // consume alias and ':'
        const typeTok = tokens[pIdx];
        pIdx++;

        const pattern = {
          alias: aliasTok.value,
          aliasRange: new Range(aliasTok.start, aliasTok.end),
          factType: typeTok ? typeTok.value : null,
          factTypeRange: typeTok ? new Range(typeTok.start, typeTok.end) : null,
          fromExpr: null,
          slots: [],
          identifiersUsed: []
        };

        // Scan tokens up to semicolon ';' or next pattern
        while (pIdx < tokens.length && tokens[pIdx].value !== ';') {
          const current = tokens[pIdx];

          // Check for 'from' keyword: e.g. b: Boolean b === true from true;
          if (current.type === 'IDENTIFIER' && current.value === 'from') {
            pIdx++;
            if (tokens[pIdx]) {
              pattern.fromExpr = tokens[pIdx].value;
              pIdx++;
            }
            continue;
          }

          // Slot binding block: { slotName: bindingVar }
          if (current.value === '{') {
            pIdx++;
            while (pIdx < tokens.length && tokens[pIdx].value !== '}') {
              const slotTok = tokens[pIdx];
              if (slotTok.type === 'IDENTIFIER' && tokens[pIdx + 1] && tokens[pIdx + 1].value === ':') {
                const bindingTok = tokens[pIdx + 2];
                pattern.slots.push({
                  slotName: slotTok.value,
                  slotRange: new Range(slotTok.start, slotTok.end),
                  bindingVar: bindingTok ? bindingTok.value : null,
                  bindingRange: bindingTok ? new Range(bindingTok.start, bindingTok.end) : null
                });
                pIdx += 2;
                if (bindingTok) pIdx++;
                if (tokens[pIdx] && tokens[pIdx].value === ',') pIdx++;
                continue;
              }
              pIdx++;
            }
            if (tokens[pIdx] && tokens[pIdx].value === '}') pIdx++;
            continue;
          }

          // Identifiers used in predicate expressions (e.g., p.name == "s3p3", opt.cost > targetCost)
          if (current.type === 'IDENTIFIER') {
            // If preceding token was '.', it's a property access (e.g. p.name -> 'name' is a property, not a variable)
            const prev = tokens[pIdx - 1];
            const isPropertyAccess = prev && prev.value === '.';
            const isKeyword = ['from', 'in', 'or', 'not', 'exists', 'true', 'false', 'null', 'undefined'].includes(current.value);

            if (!isPropertyAccess && !isKeyword) {
              pattern.identifiersUsed.push({
                name: current.value,
                range: new Range(current.start, current.end)
              });
            }
          }

          pIdx++;
        }

        if (tokens[pIdx] && tokens[pIdx].value === ';') pIdx++;
        whenNode.patterns.push(pattern);
        continue;
      }

      // Pattern format 2 without alias: FactType [condition] ;
      if (tok.type === 'IDENTIFIER' && !['or', 'not', 'exists'].includes(tok.value)) {
        const typeTok = tok;
        pIdx++;
        const pattern = {
          alias: null,
          aliasRange: null,
          factType: typeTok.value,
          factTypeRange: new Range(typeTok.start, typeTok.end),
          fromExpr: null,
          slots: [],
          identifiersUsed: []
        };

        while (pIdx < tokens.length && tokens[pIdx].value !== ';') {
          const current = tokens[pIdx];
          if (current.type === 'IDENTIFIER') {
            const prev = tokens[pIdx - 1];
            const isPropertyAccess = prev && prev.value === '.';
            if (!isPropertyAccess && !['from', 'in', 'true', 'false', 'null'].includes(current.value)) {
              pattern.identifiersUsed.push({
                name: current.value,
                range: new Range(current.start, current.end)
              });
            }
          }
          pIdx++;
        }
        if (tokens[pIdx] && tokens[pIdx].value === ';') pIdx++;
        whenNode.patterns.push(pattern);
        continue;
      }

      pIdx++;
    }

    return whenNode;
  }

  /**
   * Parse action statements within a rule's then { ... } block
   */
  parseThenBlock(tokens, thenRange, rawText, startOffset) {
    const thenNode = {
      range: thenRange,
      rawText,
      localDeclarations: [],
      identifiersUsed: []
    };

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];

      // Variable declarations: let x = ..., const y = ..., var z = ...
      if (tok.type === 'IDENTIFIER' && ['let', 'const', 'var'].includes(tok.value)) {
        i++;
        while (i < tokens.length && tokens[i].value !== ';') {
          if (tokens[i].type === 'IDENTIFIER') {
            thenNode.localDeclarations.push({
              name: tokens[i].value,
              range: new Range(tokens[i].start, tokens[i].end)
            });
            // Skip initialization up to comma or semicolon
            i++;
            if (tokens[i] && tokens[i].value === '=') {
              i++;
              let parenDepth = 0;
              let braceDepth = 0;
              while (i < tokens.length) {
                if (tokens[i].value === '(') parenDepth++;
                else if (tokens[i].value === ')') parenDepth--;
                else if (tokens[i].value === '{') braceDepth++;
                else if (tokens[i].value === '}') braceDepth--;
                else if ((tokens[i].value === ',' || tokens[i].value === ';') && parenDepth === 0 && braceDepth === 0) {
                  break;
                }
                // Also scan identifiers used on RHS of initializer!
                if (tokens[i].type === 'IDENTIFIER') {
                  const prev = tokens[i - 1];
                  const isProp = prev && prev.value === '.';
                  if (!isProp) {
                    thenNode.identifiersUsed.push({
                      name: tokens[i].value,
                      range: new Range(tokens[i].start, tokens[i].end)
                    });
                  }
                }
                i++;
              }
            }
          } else {
            i++;
          }
        }
        if (tokens[i] && tokens[i].value === ';') i++;
        continue;
      }

      // Anonymous or named function parameter extraction: function(a, b) { ... }
      if (tok.type === 'IDENTIFIER' && tok.value === 'function') {
        i++;
        // Optional function name
        if (tokens[i] && tokens[i].type === 'IDENTIFIER' && tokens[i].value !== '(') {
          thenNode.localDeclarations.push({
            name: tokens[i].value,
            range: new Range(tokens[i].start, tokens[i].end)
          });
          i++;
        }
        if (tokens[i] && tokens[i].value === '(') {
          i++;
          while (i < tokens.length && tokens[i].value !== ')') {
            if (tokens[i].type === 'IDENTIFIER') {
              thenNode.localDeclarations.push({
                name: tokens[i].value,
                range: new Range(tokens[i].start, tokens[i].end)
              });
            }
            i++;
          }
        }
      }

      // Identifier reference in expression
      if (tok.type === 'IDENTIFIER') {
        const prev = tokens[i - 1];
        const next = tokens[i + 1];
        const isPropertyAccess = prev && prev.value === '.';
        const isObjectKey = next && next.value === ':' && prev && (prev.value === '{' || prev.value === ',');
        const isKeyword = ['function', 'return', 'if', 'else', 'for', 'while', 'new', 'try', 'catch', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this'].includes(tok.value);

        if (!isPropertyAccess && !isObjectKey && !isKeyword) {
          thenNode.identifiersUsed.push({
            name: tok.value,
            range: new Range(tok.start, tok.end)
          });
        }
      }

      i++;
    }

    return thenNode;
  }
}

module.exports = {
  Position,
  Range,
  Token,
  NoolsParser
};
