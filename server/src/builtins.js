/**
 * Nools & CTAT Language Server - Built-in Symbols Catalog
 * Contains all standard Rete primitives, CTAT pedagogical functions,
 * and JavaScript runtime globals recognized out of the box.
 */

// Core Rete rule engine primitives provided by Nools runtime
const RETE_PRIMITIVES = new Set([
  'assert',
  'modify',
  'retract',
  'halt',
  'focus',
  'emit'
]);

// Pedagogical and model tracing primitives provided by CTAT runtime
const CTAT_PRIMITIVES = new Set([
  'checkSAI',
  'predictSAI',
  'backtrack',
  'setCustomField',
  'setSuccessOrFeedback',
  'setSuccessOrCommFailure',
  'printAgenda',
  'printFacts',
  'printRules',
  'printConflictTree'
]);

// Standard JavaScript global objects, classes, and helper functions
const JS_GLOBALS = new Set([
  'console',
  'Math',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Date',
  'RegExp',
  'JSON',
  'Map',
  'Set',
  'Promise',
  'Error',
  'TypeError',
  'RangeError',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'decodeURI',
  'encodeURIComponent',
  'decodeURIComponent',
  'Infinity',
  'NaN',
  'undefined',
  'null',
  'true',
  'false',
  'arguments'
]);

// Standard primitive / base types recognized in pattern matching
const STANDARD_TYPES = new Set([
  'Boolean',
  'String',
  'Number',
  'Date',
  'RegExp',
  'Array',
  'Object'
]);

module.exports = {
  RETE_PRIMITIVES,
  CTAT_PRIMITIVES,
  JS_GLOBALS,
  STANDARD_TYPES,
  isBuiltinSymbol(name) {
    return RETE_PRIMITIVES.has(name) || CTAT_PRIMITIVES.has(name) || JS_GLOBALS.has(name);
  },
  isBuiltinType(name) {
    return STANDARD_TYPES.has(name);
  }
};
