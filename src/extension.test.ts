// Tests for the extension system

import {
  run,
  compileToJS,
  createLanguageWithExtensions,
  loadExtension,
} from "./extension.ts";
import { CoreInterpretOps } from "./interpret.ts";
import type { Extension } from "./types.ts";
import { logger } from "./logger.ts";

// === Base language tests ===

logger.info("Testing core language...");
const searchPaths: string[] = [];

const core = await loadExtension("core", searchPaths);
const baseLang = await createLanguageWithExtensions([core]);

let result = await run(baseLang, "42");
if (result !== 42) {
  throw new Error(`Expected 42, got: ${result}`);
}

result = await run(baseLang, "let x = 1 in x");
if (result !== 1) {
  throw new Error(`Expected 1, got: ${result}`);
}

result = await run(baseLang, "let f = (x) => x in f(42)");
if (result !== 42) {
  throw new Error(`Expected 42, got: ${result}`);
}

logger.info("Base language tests passed!");

// === Extension: custom let (demonstrates overriding) ===

logger.info("Testing custom let extension...");

// This extension changes let to log when called
const letLogExtension = {
  $interpret: ($: CoreInterpretOps) => {
    const baseLet = $.let;
    $.let = ($env, name, valueFn, bodyFn) => {
      logger.info(`  [let ${name}]`);
      return baseLet($env, name, valueFn, bodyFn);
    };
  },
} as Extension;

const logLang = await createLanguageWithExtensions([
  letLogExtension,
]);

// Test that basic stuff still works
result = await run(logLang, "let x = 42 in x");
if (result !== 42) {
  throw new Error(`Expected 42, got: ${result}`);
}

logger.info("Custom let extension tests passed!");

// === Extension: tracing interpreter ===

logger.info("Testing tracing extension...");

const trace: string[] = [];

// Tracing extension - wraps methods to log calls
const tracingExtension = {
  $interpret: ($: CoreInterpretOps) => {
    const baseNumber = $.number;
    const baseLookup = $.lookup;
    const baseLet = $.let;

    $.number = (n) => {
      trace.push(`number(${n})`);
      return baseNumber(n);
    };

    $.lookup = ($env, name) => {
      trace.push(`lookup(${name})`);
      return baseLookup($env, name);
    };

    $.let = ($env, name, valueFn, bodyFn) => {
      trace.push(`let(${name})`);
      return baseLet($env, name, valueFn, bodyFn);
    };
  },
} as Extension;

const tracingLang = await createLanguageWithExtensions([
  core,
  tracingExtension,
]);

trace.length = 0;
result = await run(tracingLang, "let x = 42 in x");

if (!trace.includes("let(x)")) {
  throw new Error(`Expected trace to include let(x), got: ${trace}`);
}
if (!trace.includes("number(42)")) {
  throw new Error(`Expected trace to include number(42), got: ${trace}`);
}
if (!trace.includes("lookup(x)")) {
  throw new Error(`Expected trace to include lookup(x), got: ${trace}`);
}

logger.info("Tracing extension tests passed!");

// === Compile to JS string ===

logger.info("Testing compileToJS...");

const js = compileToJS(baseLang, "let x = 1 in x");
if (!js.includes("$.let")) {
  throw new Error(`Expected $.let in output, got: ${js}`);
}
if (!js.includes("export default")) {
  throw new Error(`Expected export default in output, got: ${js}`);
}

logger.info("compileToJS tests passed!");

// === Multiple extensions ===

logger.info("Testing multiple extensions...");
const countingExtension = {
  $interpret: ($: CoreInterpretOps) => {
    const baseCall = $.call;
    let callCount = 0;

    $.call = (fn, args) => {
      callCount++;
      // Store count on $ itself instead of env
      ($ as any)._callCount = callCount;
      return baseCall(fn, args);
    };
  },
} as Extension;

// Compose tracing + counting
const combinedLang = await createLanguageWithExtensions([
  core,
  tracingExtension,
  countingExtension,
]);

trace.length = 0;
result = await run(combinedLang, "let f = (x) => x in f(42)");
if (result !== 42) {
  throw new Error(`Expected 42, got: ${result}`);
}
if (!trace.includes("let(f)")) {
  throw new Error(`Expected trace to include let(f)`);
}

logger.info("Multiple extensions tests passed!");

// === Simple wrapper extension (tests open recursion) ===

logger.info("Testing simple wrapper extension...");

const simpleTrace: string[] = [];

// This extension ONLY wraps number - mutation style
const simpleTracingExtension = {
  $interpret: ($: CoreInterpretOps) => {
    const baseNumber = $.number;
    $.number = (n) => {
      simpleTrace.push(`number(${n})`);
      return baseNumber(n);
    };
  },
} as Extension;

const simpleLang = await createLanguageWithExtensions([
  core,
  simpleTracingExtension,
]);

simpleTrace.length = 0;
result = await run(simpleLang, "let x = 42 in x");
if (result !== 42) {
  throw new Error(`Expected 42, got: ${result}`);
}

// This is the key test: does the traced number get called inside the let?
if (!simpleTrace.includes("number(42)")) {
  throw new Error(
    `Expected simpleTrace to include number(42), got: ${simpleTrace}`
  );
}

logger.info("Simple wrapper extension tests passed!");

logger.info("\nAll extension tests passed!");
