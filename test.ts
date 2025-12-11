// Test runner for next-gen Unsound
// Supports multi-phase pipelines: parse, compile, emit, interpret
//
// File format:
//   # Comment
//   #usc -x meso -x const    # Load extensions (like //usc in .us files)
//
//   --- test name
//   input (source code, AST JSON, or IR JSON based on first phase)
//   === pipeline-spec
//   expected output
//
// Pipeline syntax:
//   === parse: $parse                    # Input is source code
//   === compile: $compile                # Input is AST JSON
//   === emit: $emit                      # Input is IR JSON
//   === parse: $parse, compile: $compile # Chained phases
//   === ..., emit: $emit                 # Reuse previous prefix
//   === parse, compile, emit             # Shorthand: "phase" = "phase: $phase"
//   ===                                  # Default: parse, compile, emit, interpret
//   === parse, error                     # Expect error after parse
//   === error                            # Expect error in default pipeline
//
// Input type is inferred from first phase:
//   parse    → source code (string)
//   compile  → AST (JSON object)
//   emit     → IR (JSON object)
//   interpret → IR (JSON object)

import { readdirSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { emitString, emitProgramString, emitProgramClosure } from './emit.ts';
import { createLanguage, loadExtension as loadExt, type Language } from './extension.ts';
import { prettyPrint } from './pretty.ts';
import type { Expr } from './ast.ts';
import type { ParserOps } from './parse.ts';
import type { CompilerOps } from './compile.ts';
import type { IR } from './ir.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, 'tests');

// Colors for terminal output
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;

// Test result tracking
let passed = 0;
let failed = 0;

interface TestFailure {
  testId: string;
  errors: string[];
}

const failures: TestFailure[] = [];

// Emit operations object
const $emit = {
  string: emitString,
  programString: emitProgramString,
  programClosure: emitProgramClosure,
};

// Strip location fields from AST for test comparison
// Tests check AST structure, not locations
function stripLocations(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripLocations);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    // Skip location fields
    if (key === 'loc' || key === 'nameLoc' || key === 'paramsLoc' || key === 'keyLoc') {
      continue;
    }
    result[key] = stripLocations(val);
  }
  return result;
}

// Built-in implementation names that reference the language
const LANG_BUILTINS = new Set(['$parse', '$compile', '$emit', '$interpret']);

// Standalone builtins (not from language)
const STANDALONE_BUILTINS: Record<string, Record<string, unknown>> = {
  // Currently empty - all builtins come from the language
};

// Phase definition
interface Phase {
  name: string;       // parse, compile, eval
  impl: string;       // parser, compiler, $eval, or path to .us file
}

// Standard implementations for each phase (used when elided)
const STANDARD_IMPLS: Record<string, string> = {
  parse: '$parse',
  compile: '$compile',
  emit: '$emit',
  interpret: '$interpret',
};

// Default pipeline when none specified
const DEFAULT_PIPELINE = 'parse, compile, emit, interpret';

interface Pipeline {
  phases: Phase[];
  expectError: boolean;
}

// Parse a pipeline specification like "parse: parser, compile: compiler"
// Supports "..." to reuse previous pipeline prefix (all but last phase)
// Supports "error" as terminal to indicate error is expected
function parsePipeline(spec: string, previousPrefix: Phase[] = []): Pipeline {
  const phases: Phase[] = [];
  const parts = spec.split(',').map(s => s.trim());
  let expectError = false;

  for (const part of parts) {
    // Handle ... to reuse previous prefix
    if (part === '...') {
      phases.push(...previousPrefix);
      continue;
    }

    // Handle "error" as special terminal marker
    if (part === 'error') {
      expectError = true;
      // If no phases yet, use default pipeline
      if (phases.length === 0) {
        for (const name of ['parse', 'compile', 'emit', 'interpret']) {
          phases.push({ name, impl: STANDARD_IMPLS[name] });
        }
      }
      continue;
    }

    const [name, impl] = part.split(':').map(s => s.trim());
    if (!impl) {
      // Bare phase name - use standard implementation
      if (STANDARD_IMPLS[name]) {
        phases.push({ name, impl: STANDARD_IMPLS[name] });
      } else {
        throw new Error(`Invalid pipeline spec: ${part} (unknown phase or missing impl)`);
      }
    } else {
      phases.push({ name, impl });
    }
  }

  return { phases, expectError };
}

// Run a single phase
async function runPhase(
  phase: Phase,
  input: unknown,
  lang: Language
): Promise<unknown> {
  const { name, impl } = phase;

  // Get implementation from language or standalone builtins
  let builtin: unknown;
  if (LANG_BUILTINS.has(impl)) {
    // Get from language object
    switch (impl) {
      case '$parse': builtin = lang.$parse; break;
      case '$compile': builtin = lang.$compile; break;
      case '$emit': builtin = lang.$emit; break;
      case '$interpret': builtin = lang.$interpret; break;
    }
  } else if (STANDALONE_BUILTINS[name]?.[impl]) {
    builtin = STANDALONE_BUILTINS[name][impl];
  }

  if (!builtin) {
    throw new Error(`Unknown implementation: ${impl} for phase ${name}`);
  }

  switch (name) {
    case 'parse': {
      const parser = builtin as ParserOps;
      const source = input as string;
      const result = parser.program()(source, 0);
      if (!result.ok) {
        throw new Error(`Parse error at ${result.pos}: expected ${result.expected}`);
      }
      // Strip locations for test comparison (tests check structure, not positions)
      return stripLocations(result.value);
    }

    case 'compile': {
      const compiler = builtin as CompilerOps;
      const ast = input as Expr;
      return compiler.compileProgram(ast);
    }

    case 'emit': {
      const emit = builtin as typeof $emit;
      const ir = input as IR;
      return emit.string(ir);
    }

    case 'interpret': {
      const interpreter = builtin as Record<string, unknown>;
      const ir = input as IR;
      const closure = emitProgramClosure(ir)({});
      return await (closure as Function)(interpreter);
    }

    default:
      throw new Error(`Unknown phase: ${name}`);
  }
}

// Format output for comparison
function formatOutput(value: unknown): string {
  // Code strings from emit phase - don't quote
  // Detect by presence of JS syntax: $., =>, parens, brackets
  if (typeof value === 'string' && /(\$\.|=>|\(|\[|\{)/.test(value)) {
    return value;
  }
  // Use prettyPrint for deterministic output (sorted keys, cycle-safe)
  // 'auto' mode uses multi-line for AST/IR (objects with type/tag)
  return prettyPrint(value, 'auto');
}

// Normalize expected output for comparison
function normalizeExpected(expected: string): string {
  const trimmed = expected.trim();

  // If it looks like code output, don't try to parse as JSON
  if (trimmed.includes('$.') || trimmed.includes('=>')) {
    return trimmed;
  }

  // Try to parse as JSON and re-format with prettyPrint for consistent formatting
  try {
    const parsed = JSON.parse(trimmed);
    // Re-format with prettyPrint to match formatOutput
    return prettyPrint(parsed, 'auto');
  } catch {
    // Not JSON, return as-is
    return trimmed;
  }
}

interface TestCase {
  name: string;
  input: string;
  expectations: Record<string, string>;
}

interface TestFile {
  extensions: string[];  // Extension names (like "meso", "const")
  tests: TestCase[];
}

// Parse #usc directive to get extension names
// Format: #usc -x meso -x const
function parseUscDirective(line: string): string[] {
  const match = line.match(/^#usc\s+(.+)$/);
  if (!match) return [];

  const args = match[1].trim();
  const extensions: string[] = [];
  const parts = args.split(/\s+/);

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '-x' && i + 1 < parts.length) {
      extensions.push(parts[i + 1]);
      i++;
    }
  }

  return extensions;
}

// Parse a test file into extensions and test cases
function parseTestFile(content: string, _testDir: string): TestFile {
  const extensions: string[] = [];
  const tests: TestCase[] = [];

  // Extract #usc directive and comments from the beginning
  const lines = content.split('\n');
  let contentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#usc ')) {
      // Parse #usc -x ext1 -x ext2 format
      extensions.push(...parseUscDirective(line));
      contentStart = i + 1;
    } else if (line.startsWith('#') || line === '') {
      contentStart = i + 1;
    } else {
      break;
    }
  }

  // Parse test cases from remaining content
  const testContent = lines.slice(contentStart).join('\n');
  const blocks = testContent.split(/^---\s*/m).slice(1);

  for (const block of blocks) {
    const blockLines = block.split('\n');
    const name = blockLines[0].trim();
    const rest = blockLines.slice(1).join('\n');

    // Split into input and expectations
    const parts = rest.split(/^===\s*/m);
    const input = parts[0].trim();
    const expectations: Record<string, string> = {};

    for (let i = 1; i < parts.length; i++) {
      const expLines = parts[i].split('\n');
      const pipelineSpec = expLines[0].trim();
      // Stop at comment lines (starting with #) as they start new sections
      const valueLines: string[] = [];
      for (let j = 1; j < expLines.length; j++) {
        const line = expLines[j];
        if (line.trim().startsWith('#')) break;
        valueLines.push(line);
      }
      const value = valueLines.join('\n').trim();
      // Empty pipeline spec means default pipeline
      const key = pipelineSpec || DEFAULT_PIPELINE;
      expectations[key] = value;
    }

    if (input || Object.keys(expectations).length > 0) {
      tests.push({ name, input, expectations });
    }
  }

  return { extensions, tests };
}

// Prepare input based on first phase
function prepareInput(input: string, firstPhase: string): unknown {
  switch (firstPhase) {
    case 'parse':
      // Input is source code
      return input;
    case 'compile':
    case 'emit':
    case 'interpret':
      // Input is JSON
      try {
        return JSON.parse(input);
      } catch (e) {
        throw new Error(`Invalid JSON input for ${firstPhase} phase: ${(e as Error).message}`);
      }
    default:
      return input;
  }
}

// Run a single test case
async function runTest(test: TestCase, filename: string, lang: Language): Promise<void> {
  const { name, input, expectations } = test;
  const testId = `${filename}::${name}`;
  const errors: string[] = [];

  let previousPrefix: Phase[] = [];

  for (const [pipelineSpec, expectedValue] of Object.entries(expectations)) {
    try {
      const { phases, expectError } = parsePipeline(pipelineSpec, previousPrefix);

      if (phases.length === 0) {
        errors.push(`${pipelineSpec}: empty pipeline`);
        continue;
      }

      // Save prefix (all but last) for next iteration
      previousPrefix = phases.slice(0, -1);

      // Prepare input based on first phase
      const firstPhase = phases[0].name;
      let result: unknown = prepareInput(input, firstPhase);

      // Run pipeline
      for (const phase of phases) {
        result = await runPhase(phase, result, lang);
      }

      // If we expected an error but didn't get one, that's a failure
      if (expectError) {
        errors.push(`${pipelineSpec}: expected error but got result: ${formatOutput(result)}`);
        continue;
      }

      // Format and compare
      const actual = formatOutput(result);
      const expected = normalizeExpected(expectedValue);

      if (actual !== expected) {
        errors.push(`${pipelineSpec}:\n  expected: ${expected}\n  got:      ${actual}`);
      }
    } catch (e) {
      const errMsg = (e as Error).message;
      const { expectError } = parsePipeline(pipelineSpec, previousPrefix);

      // Check if error was expected
      if (expectError) {
        if (!expectedValue || errMsg.includes(expectedValue)) {
          // Success - error was expected
          continue;
        }
        errors.push(`${pipelineSpec}: expected error "${expectedValue}", got: ${errMsg}`);
      } else {
        errors.push(`${pipelineSpec}: error: ${errMsg}`);
      }
    }
  }

  // Report result
  if (errors.length === 0) {
    passed++;
    console.log(`${green('✓')} ${testId}`);
  } else {
    failed++;
    failures.push({ testId, errors });
    console.log(`${red('✗')} ${testId}`);
    for (const err of errors) {
      console.log(`  ${dim(err)}`);
    }
  }
}

// Main test runner
async function runTests(): Promise<void> {
  console.log('Running next-gen Unsound tests...\n');

  // Create tests directory if it doesn't exist
  if (!existsSync(TESTS_DIR)) {
    mkdirSync(TESTS_DIR);
    console.log(dim('Created tests directory'));
  }

  let files: string[];
  try {
    files = readdirSync(TESTS_DIR).filter(f => f.endsWith('.test'));
  } catch {
    files = [];
  }

  if (files.length === 0) {
    console.log(dim('No test files found in tests/'));
    console.log(dim('Create .test files with the format:'));
    console.log(dim('  #usc -x meso           # Optional extensions'));
    console.log(dim('  --- test name'));
    console.log(dim('  source code'));
    console.log(dim('  === parse: $parse'));
    console.log(dim('  { "type": "Literal", ... }'));
    return;
  }

  for (const file of files.sort()) {
    const filePath = join(TESTS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const testFile = parseTestFile(content, TESTS_DIR);

    // Build language with core extension first, then file-specific extensions
    let lang = createLanguage([]);
    await loadExt('core', lang);

    for (const extName of testFile.extensions) {
      try {
        await loadExt(extName, lang);
      } catch (e) {
        console.error(`${red('✗')} ${file}: Failed to load extension ${extName}`);
        console.error(`  ${dim((e as Error).message)}`);
        failed++;
        continue;
      }
    }

    for (const test of testFile.tests) {
      await runTest(test, file, lang);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
