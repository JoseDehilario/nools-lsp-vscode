/**
 * Automated Test Runner for Nools Language Server
 * Verifies AST Parsing, Scope Hierarchy, Semantic Diagnostics, and LSP Protocol.
 */

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

const { NoolsParser } = require('../server/src/parser');
const { ScopeManager } = require('../server/src/scope');
const { DiagnosticEngine, DiagnosticSeverity } = require('../server/src/diagnostics');
const { NoolsLanguageServer } = require('../server/src/server');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

console.log('====================================================');
console.log(' Running Nools LSP Test Suite');
console.log('====================================================\n');

// ----------------------------------------------------
// Test 1: Parser on types.nools
// ----------------------------------------------------
console.log('[Test Suite 1] Parsing fact types in types.nools...');
const typesCode = fs.readFileSync(path.join(__dirname, 'test-samples', 'types.nools'), 'utf-8');
const typesParser = new NoolsParser(typesCode, 'file:///types.nools');
const typesAST = typesParser.parse();

assert(typesAST.defines.length === 3, `Expected 3 defines, parsed ${typesAST.defines.length}`);
const problemDefine = typesAST.defines.find(d => d.name === 'Problem');
assert(problemDefine !== undefined, 'Found define Problem');
assert(problemDefine && problemDefine.slots.some(s => s.name === 'name'), 'Problem has slot "name"');
assert(problemDefine && problemDefine.slots.some(s => s.name === 'subgoals'), 'Problem has slot "subgoals"');

// ----------------------------------------------------
// Test 2: Validation of valid_model.nools (0 Errors expected)
// ----------------------------------------------------
console.log('\n[Test Suite 2] Validating valid_model.nools...');
const scopeManager = new ScopeManager();
scopeManager.updateFile('file:///types.nools', typesAST);

const validCode = fs.readFileSync(path.join(__dirname, 'test-samples', 'valid_model.nools'), 'utf-8');
const validParser = new NoolsParser(validCode, 'file:///valid_model.nools');
const validAST = validParser.parse();
scopeManager.updateFile('file:///valid_model.nools', validAST);

const diagEngine = new DiagnosticEngine(scopeManager);
const validDiagnostics = diagEngine.validate(validAST);

assert(validDiagnostics.length === 0, `Expected 0 diagnostics for valid model, received ${validDiagnostics.length}`);
if (validDiagnostics.length > 0) {
  console.log('Unexpected diagnostics:', validDiagnostics);
}

// ----------------------------------------------------
// Test 3: Detecting Undefined Terms in undefined_terms.nools
// ----------------------------------------------------
console.log('\n[Test Suite 3] Detecting undefined terms in undefined_terms.nools...');
const errorScopeManager = new ScopeManager();
errorScopeManager.updateFile('file:///types.nools', typesAST);

const errorCode = fs.readFileSync(path.join(__dirname, 'test-samples', 'undefined_terms.nools'), 'utf-8');
const errorParser = new NoolsParser(errorCode, 'file:///undefined_terms.nools');
const errorAST = errorParser.parse();
errorScopeManager.updateFile('file:///undefined_terms.nools', errorAST);

const errorDiagEngine = new DiagnosticEngine(errorScopeManager);
const errorDiagnostics = errorDiagEngine.validate(errorAST);

console.log(`  Found ${errorDiagnostics.length} diagnostics emitted by server:`);
for (const d of errorDiagnostics) {
  const sev = d.severity === DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
  console.log(`    - [${sev}] Line ${d.range.start.line + 1}: ${d.message}`);
}

const hasUndefinedFactType = errorDiagnostics.some(d => d.code === 'undefined-fact-type' && d.message.includes('PhantomType'));
assert(hasUndefinedFactType, 'Alerted undefined fact type "PhantomType"');

const hasUndefinedConditionTerm = errorDiagnostics.some(d => d.code === 'undefined-condition-term' && d.message.includes('unknownThreshold'));
assert(hasUndefinedConditionTerm, 'Alerted undefined condition identifier "unknownThreshold"');

const hasUndefinedSlot = errorDiagnostics.some(d => d.code === 'undefined-slot-name' && d.message.includes('fakeSlot'));
assert(hasUndefinedSlot, 'Alerted undefined slot "fakeSlot" on fact type Option');

const hasUndefinedAlias = errorDiagnostics.some(d => d.code === 'undefined-action-term' && d.message.includes('ghostAlias'));
assert(hasUndefinedAlias, 'Alerted undefined alias "ghostAlias" in action block');

const hasUndefinedVar = errorDiagnostics.some(d => d.code === 'undefined-action-term' && d.message.includes('undeclaredTotal'));
assert(hasUndefinedVar, 'Alerted undeclared local variable "undeclaredTotal" in action block');

const hasDuplicateRule = errorDiagnostics.some(d => d.message.includes("Duplicate rule definition 'TestUndefinedTerms'"));
assert(hasDuplicateRule, 'Alerted duplicate rule definition "TestUndefinedTerms"');

// ----------------------------------------------------
// Test 4: End-to-End JSON-RPC LSP Protocol Integration
// ----------------------------------------------------
console.log('\n[Test Suite 4] End-to-end LSP JSON-RPC Protocol Simulation...');

const clientIn = new PassThrough();
const clientOut = new PassThrough();

const server = new NoolsLanguageServer(clientIn, clientOut);

let receivedResponses = [];
clientOut.on('data', chunk => {
  const str = chunk.toString('utf-8');
  const parts = str.split('\r\n\r\n');
  for (let i = 1; i < parts.length; i++) {
    try {
      if (parts[i].trim()) {
        receivedResponses.push(JSON.parse(parts[i].trim()));
      }
    } catch (e) {}
  }
});

function sendLSP(msg) {
  const json = JSON.stringify(msg);
  clientIn.write(`Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`);
}

// 1. Send initialize
sendLSP({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { capabilities: {} }
});

setTimeout(() => {
  const initResp = receivedResponses.find(r => r.id === 1);
  assert(initResp !== undefined && initResp.result && initResp.result.capabilities.hoverProvider === true, 'LSP initialize returned valid capabilities');

  // 2. Send textDocument/didOpen for valid_model.nools
  sendLSP({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: 'file:///workspace/model.nools',
        languageId: 'nools',
        version: 1,
        text: validCode
      }
    }
  });

  setTimeout(() => {
    // 3. Send textDocument/documentSymbol
    sendLSP({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/documentSymbol',
      params: {
        textDocument: { uri: 'file:///workspace/model.nools' }
      }
    });

    setTimeout(() => {
      const symResp = receivedResponses.find(r => r.id === 2);
      assert(symResp !== undefined && Array.isArray(symResp.result), 'LSP documentSymbol returned symbol outline');
      const ruleSymbol = symResp && symResp.result.find(s => s.name === 'EnterGivenAmount');
      assert(ruleSymbol !== undefined, 'Found rule symbol "EnterGivenAmount" in outline');

      // 4. Send textDocument/hover on rule EnterGivenAmount (line 16, col 8)
      sendLSP({
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/hover',
        params: {
          textDocument: { uri: 'file:///workspace/model.nools' },
          position: { line: 16, character: 8 }
        }
      });

      setTimeout(() => {
        const hoverResp = receivedResponses.find(r => r.id === 3);
        assert(hoverResp !== undefined && hoverResp.result && hoverResp.result.contents.value.includes('EnterGivenAmount'), 'LSP hover provided markdown info for rule EnterGivenAmount');

        console.log('\n====================================================');
        console.log(` Summary: ${passedTests} passed, ${failedTests} failed`);
        console.log('====================================================\n');

        if (failedTests > 0) {
          process.exit(1);
        } else {
          process.exit(0);
        }
      }, 50);
    }, 50);
  }, 50);
}, 50);
