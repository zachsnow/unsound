#!/usr/bin/env bun
// usc - Unsound compiler CLI

import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  createLanguage,
  parseUscArgs,
  parseUscDirective,
  getSearchPaths,
  type DirectiveOptions,
} from "./extension.ts";
import type { EmitOps, Language, PhaseKey } from "./types.ts";
import { formatParseError } from "./parse.ts";
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

const validModes = ["run", "module", "standalone", "binary"] as const;
const isValidMode = (mode: string): mode is (typeof validModes)[number] => {
  return validModes.includes(mode as (typeof validModes)[number]);
};

// CLI-specific options extend shared UscOptions
// compile/interpret/emit are required here (have defaults)
type CLIOptions = DirectiveOptions & {
  input?: string;
  output?: string;

  mode: (typeof validModes)[number];
  show: ("ast" | "ir" | "js")[];

  global: Record<string, unknown>;

  help: boolean;
  verbose: boolean;
};

function parseArgs(args: string[]): CLIOptions {
  // Start with shared options parsed by parseUscArgs.
  const shared = parseUscArgs(args);
  const alreadyParsed = [
    "-x",
    "--extension",
    "-p",
    "--parse",
    "-c",
    "--compile",
    "-i",
    "--interpret",
    "-e",
    "--emit",
  ];

  // Default to shared options or defaults.
  const opts: CLIOptions = {
    extensions: shared.extensions,
    parse: shared.parse ?? "parse", // Default to $parse
    compile: shared.compile ?? "compile", // Default to $compile
    emit: shared.emit ?? "emit", // Default to $emit
    interpret: shared.interpret ?? "interpret", // Default to $interpret
    mode: "run",
    show: [],
    global: {},
    help: false,
    verbose: false,
  };

  // Parse CLI-specific options.
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (alreadyParsed.includes(arg)) {
      // Already handled by parseUscArgs, skip the value for options with args (all of them).
      i++;
    } else if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "-o" || arg === "--output") {
      // Output filename.
      const output = args[++i];
      opts.output = output;
    } else if (arg === "-m" || arg === "--mode") {
      // Validate mode.
      const mode = args[++i];
      if (isValidMode(mode)) {
        opts.mode = mode;
      } else {
        console.error(`Unknown mode: ${mode}`);
        process.exit(1);
      }
    } else if (arg === "--ast") {
      opts.show.push("ast");
    } else if (arg === "--ir") {
      opts.show.push("ir");
    } else if (arg === "--js") {
      opts.show.push("js");
    } else if (arg === "-g" || arg === "--global") {
      // Parse key=value pair; wow JS String.split() is dumb.
      const [key, ...rest] = args[++i].split("=");
      const value = rest.join("=");
      try {
        opts.global[key] = JSON.parse(value);
      } catch {
        opts.global[key] = value;
      }
    } else if (arg === "-v" || arg === "--verbose") {
      opts.verbose = true;
    } else if (arg === "-") {
      // Handle reading from stdin.
      opts.input = "-";
    } else if (!arg.startsWith("-")) {
      // TODO: positional argument is input file, it would be nice to allow multiple.
      // Also, if the filename starts with "-" I guess you're out of luck?
      opts.input = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }

    // Consume parsed.
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`usc - Unsound compiler

Usage: usc [options] <input>

Input:
  <input>                             Source file to compile (use - for stdin)

Output:
  -o, --output <file>                 Write output to file (default: stdout for js, none for run)
  -m, --mode <mode>                   Output mode:
                                          run        - Execute directly (default)
                                          module     - JS exporting async ($) => result
                                          standalone - Self-contained JS with interpreter
                                          binary     - Standalone compiled with bun

Extensions:
  -x, --extension <name>              Load extension by name or path
                                      Can be used multiple times, applied in order

Phases:
  -p, --parse <key>                   Which parser to use (default: parse)
  -c, --compile <key>                 Which compiler to use (default: compile)
                                      If not 'compile', outputs result directly.
  -e, --emit <key>                    Which emitter to use (default: emit)
  -i, --interpret <key>               Which interpreter to use (default: interpret)
                                      Extensions can provide multiple interpreters:
                                        interpret - standard evaluation ($interpret)
                                        type      - type checking ($type)
                                        etc.

Environment (for run mode):
  -g, --global <key=value>            Add value to environment (JSON parsed if valid)

Debug:
  --ast                               Show parsed AST
  --ir                                Show compiled IR
  --js                                Show emitted JavaScript

Examples:
  usc program.us                      Run with core + file's //usc defaults
  usc -x core -x meso program.us      Run with core + meso (overrides file)
  usc -m module -o out.js program.us  Compile to module out.js
`);
}

// === Output Generation ===

async function generateStandalone(
  lang: Language,
  program: string,
  interpretKey: PhaseKey,
  printResult: boolean = false
): Promise<string> {
  // TODO: is this the correct source directory for resolution?
  const sourceDir = await getSourceDir();

  return `// Generated by usc (Unsound compiler)
import { createLanguage } from '${path.resolve(sourceDir, "extension.ts")}';
const lang = createLanguage([${lang.extensions
      .map((ext) => `"${ext}"`)
      .join(", ")}]);
const $ = lang.${interpretKey};
const output = ${program.replace("export default ", "").replace(/;$/, "")};
const result = await output($);
${printResult ? "if (result !== undefined) console.log(result);" : ""}
export default result;
`;
}

async function generateBinary(
  lang: Language,
  program: string,
  interpretKey: PhaseKey,
  outputPath: string,
  sourceFile?: string
): Promise<void> {
  // Generate standalone JS with result printing enabled.
  const standaloneJs = await generateStandalone(
    lang,
    program,
    interpretKey,
    true
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

async function readInput(opts: CLIOptions): Promise<string> {
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

function invalidPhase(
  phaseType: string,
  phaseName: string,
  language: Language,
  exit: boolean = true
) {
  const message = `No ${phaseType} phase '${phaseName}' found. Available: ${Object.keys(
    language
  )
    .filter((k) => k.startsWith("$"))
    .map((k) => k.slice(1))
    .join(", ")}`;
  if (exit) {
    logger.error(message);
    process.exit(1);
  } else {
    logger.warn(message);
  }
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
  const extensions =
    opts.extensions.length > 0 ? opts.extensions : directive.extensions;

  // Pick phase implementation keys; again prefer CLI, then directive, then default.
  const parse =
    opts.parse !== "parse" ? opts.parse : directive.parse ?? "parse";
  const compile =
    opts.compile !== "compile" ? opts.compile : directive.compile ?? "compile";
  const emit = opts.emit !== "emit" ? opts.emit : directive.emit ?? "emit";
  const interpret =
    opts.interpret !== "interpret"
      ? opts.interpret
      : directive.interpret ?? "interpret";

  // Get extension search paths (includes extracted sources when bundled)
  // Pass source file path so we can find project-local extensions.
  const sourceFile =
    opts.input && opts.input !== "-" ? path.resolve(opts.input) : undefined;
  const searchPaths = await getBundledSearchPaths(sourceFile);

  // Build language.
  logger.debug("loading extensions:", extensions);
  const language = await createLanguage(extensions, searchPaths);

  // Check that the requested interpreter exists; we only *really* need it
  // if we are running the program directly, but warn anyway.
  const interpretKey: PhaseKey = `$${interpret}`;
  const interpreter = language[interpretKey];
  if (!interpreter) {
    invalidPhase(`interpreter`, interpret, language, opts.mode === "run");
  }

  // Parse.
  const parseKey: PhaseKey = `$${parse}`;
  const parser = language[parseKey];
  if (!parser) {
    invalidPhase(`parser`, parse, language, true);
  }

  const parseResult = parser.program()(input, 0);
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
  const compiler = language[compileKey];
  if (!compiler) {
    invalidPhase(`compiler`, compile, language, true);
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

  // Otherwise just compile to IR.
  const ir = compiler.compileProgram(parseResult.value);

  // Show IR if requested
  if (opts.show.includes("ir")) {
    console.error("=== IR ===");
    console.error(JSON.stringify(ir, null, 2));
  }

  // Emit JS.
  const emitKey: PhaseKey = `$${emit}`;
  const emitter: EmitOps = language[emitKey];
  if (!emitter) {
    invalidPhase(`emitter`, emit, language);
  }
  const program = emitter.program(ir as IR);

  // Show JS if requested
  if (opts.show.includes("js")) {
    console.error("=== JS ===");
    console.error(program);
  }

  // Generate output based on mode.
  let output: string = "";

  switch (opts.mode) {
    case "module":
      // We already have a module.
      output = program;
      break;

    case "standalone":
      // Generate standalone JS from the program module.
      output = await generateStandalone(language, input, interpretKey, false);
      break;

    case "binary":
      if (!opts.output) {
        console.error(
          "Binary mode requires -o/--output to specify the output file"
        );
        process.exit(1);
      }

      // We rely on bun to compile, so we don't need to write output.
      await generateBinary(language, input, interpretKey, opts.output);
      break;

    case "run":
      try {
        // Even though we already generated the program, let's generate
        // a closure and run it directly instead of dynamically loading
        // the module; we have already loaded all the extensions and built
        // the interpreter.
        const closure = emitter.programClosure(ir)(opts.global);
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
