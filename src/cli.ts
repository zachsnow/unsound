#!/usr/bin/env bun
// usc - Unsound compiler CLI

import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  createLanguage,
  run, parseUscArgs,
  parseUscDirective,
  getSearchPaths,
  type UscOptions,
  BUILT_IN_PHASES
} from "./extension.ts";
import type { Language, PhaseKey } from "./types.ts";
import { emitString } from "./emit.ts";
import { formatParseError, ParseError } from "./parse.ts";
import { prettyPrint } from "./pretty.ts";
import { logger, setVerbose } from "./logger.ts";
import { IR } from "./ir.ts";

// Detect if running from a compiled binary (bun embeds in /$bunfs/)
const IS_BUNDLED = import.meta.dirname.startsWith("/$bunfs/");

// Track extracted temp directory for cleanup
let extractedSourceDir: string | null = null;

// Write embedded sources to a temp directory and return the path
async function extractEmbeddedSources(): Promise<string> {
  if (extractedSourceDir) {
    return extractedSourceDir;
  }

  // Dynamic import - only loaded when IS_BUNDLED is true
  // Bun will still bundle this since the path is a string literal
  const mod = await import("../embedded-sources.json");
  const embeddedSources: Record<string, string> = mod.default;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "usc-sources-"));

  // Create extensions subdirectory
  await fs.mkdir(path.join(tempDir, "extensions"), { recursive: true });

  // Write all embedded source files (content is stored as strings)
  for (const [relativePath, content] of Object.entries(embeddedSources)) {
    const destPath = path.join(tempDir, relativePath);
    await fs.writeFile(destPath, content);
  }

  extractedSourceDir = tempDir;
  return tempDir;
}

// Clean up extracted sources
async function cleanupExtractedSources(): Promise<void> {
  if (extractedSourceDir) {
    await fs.rm(extractedSourceDir, { recursive: true, force: true });
    extractedSourceDir = null;
  }
}

// Get source directory for binary mode compilation
async function getSourceDir(): Promise<string> {
  if (!IS_BUNDLED) {
    return import.meta.dirname;
  }
  // When bundled, extract embedded sources to temp directory
  return await extractEmbeddedSources();
}

// Get extension search paths for a given source file
// When bundled, uses extracted embedded sources for compiler extensions
async function getBundledSearchPaths(filename?: string): Promise<string[]> {
  if (!IS_BUNDLED) {
    // Use the standard search paths from extension.ts
    return getSearchPaths(filename);
  }
  // When bundled, override compiler extensions dir with extracted sources
  const extractedDir = await extractEmbeddedSources();
  return getSearchPaths(filename, path.join(extractedDir, "extensions"));
}

// === Argument Parsing ===

// CLI-specific options extend shared UscOptions
// compile/interpret/emit are required here (have defaults)
type Options = Omit<UscOptions, "compile" | "interpret" | "emit"> & {
  input?: string;
  output?: string;
  compile: string; // Which compiler key to use (default: "compile")
  emit: string; // Which emit key to use (default: "emit")
  interpret: string; // Which interpreter key to use (default: "interpret")
  mode: "run" | "module" | "standalone" | "binary";
  show: ("ast" | "ir" | "js")[];
  env: Record<string, unknown>;
  help: boolean;
  verbose: boolean;
};

function parseArgs(args: string[]): Options {
  // Start with shared options parsed by parseUscArgs
  const shared = parseUscArgs(args);

  const opts: Options = {
    extensions: shared.extensions,
    noCore: shared.noCore,
    compile: shared.compile ?? "compile", // Default to $compile
    emit: shared.emit ?? "emit", // Default to $emit
    interpret: shared.interpret ?? "interpret", // Default to $interpret
    mode: "run",
    show: [],
    env: {},
    help: false,
    verbose: false,
  };

  // Parse CLI-specific options
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      opts.help = true;
      i++;
    } else if (
      arg === "--no-core" ||
      arg === "-x" ||
      arg === "--extension" ||
      arg === "-c" ||
      arg === "--compile" ||
      arg === "-i" ||
      arg === "--interpret" ||
      arg === "--emit"
    ) {
      // Already handled by parseUscArgs, skip the value for options with args
      if (arg !== "--no-core") i++;
      i++;
    } else if (arg === "-o" || arg === "--output") {
      opts.output = args[++i];
      i++;
    } else if (arg === "-m" || arg === "--mode") {
      const mode = args[++i];
      if (
        mode === "run" ||
        mode === "module" ||
        mode === "standalone" ||
        mode === "binary"
      ) {
        opts.mode = mode;
      } else {
        console.error(`Unknown mode: ${mode}`);
        process.exit(1);
      }
      i++;
    } else if (arg === "--ast") {
      opts.show.push("ast");
      i++;
    } else if (arg === "--ir") {
      opts.show.push("ir");
      i++;
    } else if (arg === "--js") {
      opts.show.push("js");
      i++;
    } else if (arg === "-e" || arg === "--env") {
      const [key, value] = args[++i].split("=");
      try {
        opts.env[key] = JSON.parse(value);
      } catch {
        opts.env[key] = value;
      }
      i++;
    } else if (arg === "-v" || arg === "--verbose") {
      opts.verbose = true;
      i++;
    } else if (arg === "-") {
      opts.input = "-";
      i++;
    } else if (!arg.startsWith("-")) {
      opts.input = arg;
      i++;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`usc - Unsound compiler

Usage: usc [options] <input>

Input:
  <input>              Source file to compile (use - for stdin)

Output:
  -o, --output <file>  Write output to file (default: stdout for js, none for run)
  -m, --mode <mode>    Output mode:
                          run        - Execute directly (default)
                          module     - JS exporting async ($) => result
                          standalone - Self-contained JS with interpreter
                          binary     - Standalone compiled with bun

Extensions:
  -x, --extension <name>  Load extension by name or path
                          Can be used multiple times, applied in order
                          Searches: extensions/, then current directory
                          Supports .ts/.js and .us files
  --no-core               Skip loading core extension (for testing)

  Default extensions can be set in source file:
    //usc -x meso -x const

  CLI -x flags override file defaults (not additive).

Phases:
  -c, --compile <key>     Which compiler to use (default: compile)
                          Extensions can provide alternative compilers:
                            compile  - standard compilation to IR ($compile)
                            analyze  - static analysis ($analyze)
                          If not 'compile', outputs result directly.
  --emit <key>            Which emitter to use (default: emit)
  -i, --interpret <key>   Which interpreter to use (default: interpret)
                          Extensions can provide multiple interpreters:
                            interpret - standard evaluation ($interpret)
                            type      - type checking ($type)
                            etc.

Environment (for run mode):
  -e, --env <key=value>   Add value to environment (JSON parsed if valid)

Debug:
  --ast                Show parsed AST
  --ir                 Show compiled IR
  --js                 Show emitted JavaScript

Examples:
  usc program.us                      Run with core + file's //usc defaults
  usc -x meso program.us              Run with core + meso (overrides file)
  usc --no-core -x meso program.us    Run with meso only (no core)
  usc -m module -o out.js program.us  Compile to module
`);
}

// === Output Generation ===

async function generateStandalone(
  lang: Language,
  ir: unknown,
  extNames: string[],
  noCore: boolean,
  printResult: boolean = false,
  sourceFile?: string
): Promise<string> {
  const sourceDir = await getSourceDir();

  // Compile the main program with the full language
  const program = lang.$emit.program(ir);
  if (typeof program !== "string") {
    throw new Error(
      "bad pipeline: expected emitted program to be a string when generating standalone"
    );
  }

  return `// Generated by usc (Unsound compiler)
import { createLanguage } from '${path.resolve(sourceDir, "extension.ts")}';
const lang = createLanguage([${lang.extensions
      .map((ext) => `"${ext}"`)
      .join(", ")}]);
const $ = lang.$interpret;
const output = ${program.replace("export default ", "").replace(/;$/, "")};
const result = await output($);
${printResult ? "if (result !== undefined) console.log(result);" : ""}
export default result;
`;
}

async function generateBinary(
  lang: Language,
  ir: unknown,
  extNames: string[],
  noCore: boolean,
  outputPath: string,
  sourceFile?: string
): Promise<void> {
  // Generate standalone JS with result printing enabled
  const standaloneJs = await generateStandalone(
    lang,
    ir,
    extNames,
    noCore,
    true,
    sourceFile
  );

  // Write to a temp file in system temp directory
  const tempFile = path.join(os.tmpdir(), `.usc-standalone-${process.pid}.ts`);
  await fs.writeFile(tempFile, standaloneJs);

  try {
    // Compile with bun
    const proc = Bun.spawnSync(
      ["bun", "build", "--compile", tempFile, "--outfile", outputPath],
      {
        stdio: ["inherit", "inherit", "inherit"],
      }
    );

    if (proc.exitCode !== 0) {
      throw new Error(
        `bun build --compile failed with exit code ${proc.exitCode}`
      );
    }
  } finally {
    // Clean up temp file and extracted sources
    await fs.unlink(tempFile);
    cleanupExtractedSources();
  }
}

async function readInput(opts: Options): Promise<string> {
  // Optionally read from stdin.
  if (!opts.input || opts.input === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  // Otherwise we should have a filename.
  return fs.readFile(opts.input, "utf-8");
}

// === Main ===

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  // Set verbose early.
  setVerbose(opts.verbose);

  // Help.
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // Read input.
  const input = await readInput(opts);

  // Parse directive from source to get file defaults.
  const directive = parseUscDirective(input);

  // Merge options: CLI explicit > directive > defaults.
  // For extensions: CLI -x flags override directive (not additive)
  const extNames =
    opts.extensions.length > 0 ? opts.extensions : directive.extensions;
  const noCore = opts.noCore || directive.noCore;
  const compile =
    opts.compile !== "compile" ? opts.compile : directive.compile ?? "compile";
  const interpret =
    opts.interpret !== "interpret"
      ? opts.interpret
      : directive.interpret ?? "interpret";
  const emit = opts.emit !== "emit" ? opts.emit : directive.emit ?? "emit";

  // Get extension search paths (includes extracted sources when bundled)
  // Pass source file path so we can find project-local extensions.
  const sourceFile =
    opts.input && opts.input !== "-" ? path.resolve(opts.input) : undefined;
  const searchPaths = await getBundledSearchPaths(sourceFile);

  // Build language.
  if (!noCore) {
    extNames.unshift("core");
  }
  logger.debug("loading extensions:", extNames);
  let lang = await createLanguage(extNames, searchPaths);

  // Check that the requested interpreter exists
  const interpretKey: PhaseKey = `$${interpret}`;
  const interpreter = lang[interpretKey];
  if (opts.mode === "run" && !interpreter) {
    console.error(
      `No interpreter '${interpret}' found. Available: ${Object.keys(lang)
        .filter((k) => k.startsWith("$") && !BUILT_IN_PHASES.includes(k as any))
        .map((k) => k.slice(1))
        .join(", ")}`
    );
    process.exit(1);
  }

  // Parse
  const parseResult = lang.$parse.program()(input, 0);
  if (!parseResult.ok) {
    console.error(
      formatParseError(input, parseResult.pos, parseResult.expected)
    );
    process.exit(1);
  }

  // Show AST if requested
  if (opts.show.includes("ast")) {
    console.error("=== AST ===");
    console.error(JSON.stringify(parseResult.value, null, 2));
  }

  // Compile (using specified compile phase)
  const compileKey: PhaseKey = `$${compile}`;
  const compiler = lang[compileKey];
  if (!compiler) {
    console.error(
      `No compiler '${compile}' found. Available: ${Object.keys(lang)
        .filter((k) => k.startsWith("$"))
        .map((k) => k.slice(1))
        .join(", ")}`
    );
    process.exit(1);
  }

  // For non-standard compile phases, output result directly
  if (compile !== "compile") {
    // Call the appropriate entry point (analyzeProgram for analyze, etc.)
    const entryPoint =
      compile === "analyze" ? "analyzeProgram" : "compileProgram";
    if (typeof compiler[entryPoint] !== "function") {
      console.error(`Compiler '${compile}' has no ${entryPoint} method`);
      process.exit(1);
    }

    const result = compiler[entryPoint](parseResult.value);
    console.log(prettyPrint(result, "auto"));
    process.exit(0);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);

  // Show IR if requested
  if (opts.show.includes("ir")) {
    console.error("=== IR ===");
    console.error(JSON.stringify(ir, null, 2));
  }

  // Show JS if requested
  if (opts.show.includes("js")) {
    console.error("=== JS ===");
    console.error(emitString(ir as IR));
  }

  // Generate output based on mode
  let output: string = "";
  let result: unknown;

  switch (opts.mode) {
    case "module":
      output = lang.$emit.program(ir);
      break;

    case "standalone":
      output = await generateStandalone(
        lang,
        input,
        extNames,
        opts.noCore,
        false,
        sourceFile
      );
      break;

    case "binary":
      if (!opts.output) {
        console.error(
          "Binary mode requires -o/--output to specify the output file"
        );
        process.exit(1);
      }
      await generateBinary(
        lang,
        input,
        extNames,
        opts.noCore,
        opts.output,
        sourceFile
      );
      break;

    case "run":
      try {
        const closure = lang.$emit.programClosure(ir)(opts.env);
        const result = await closure(interpreter);
        if (result !== undefined) {
          console.log(result);
        }
      } catch (e) {
        logger.error("interpreter error:", e);
        process.exit(1);
      }
      break;
  }

  // Write output
  if (output) {
    if (opts.output) {
      await fs.writeFile(opts.output, output);
    } else {
      console.log(output);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
