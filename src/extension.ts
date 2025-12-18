/**
 * Extensions for Unsound
 *
 * An extension is an object with optional $parse, $compile, $emit, $interpret, $analyze keys.
 * Each is a builder function that takes the base implementation and returns an extended one.
 * Extensions can include metadata:
 *
 *  name: string        - Must match file basename (e.g., "meso" for meso.us)
 *  description: string - Human-readable description
 *  requires: string[]  - Names of required extensions (those that must be loaded first)
 *  version: string     - Extension version
 */
import fs from "fs/promises";

import { join, basename, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { formatParseError } from "./parse.ts";
import {
  type CompileOps,
  type AnalyzeOps,
  type EmitOps,
  type Extension,
  type Language,
  type InterpretOps,
  type ParseOps,
  type PhaseKey,
  type ResolvedExtension,
  isPhaseKey,
} from "./types.ts";
import { emptyExtension } from "./empty.ts";

import { Logger } from "./logger.ts";

const logger = new Logger("extension");

// Get the compiler's extensions directory (stdlib)
// When running from source, this is src/extensions relative to the module
export const EXTENSIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "extensions"
);

/**
 * The built-in phases of the pipeline.
 */
export const BUILT_IN_PHASES = [
  "$parse",
  "$compile",
  "$analyze",
  "$emit",
] as const;

// Build search paths for extension resolution
// Order: source-dir/extensions, source-dir, compiler-extensions
// compilerExtDir can be overridden (e.g., when running from bundled binary)
export function getSearchPaths(
  filename: string | undefined,
  compilerExtensionsDir: string = EXTENSIONS_DIR
): string[] {
  const paths: string[] = [];

  // Allow passing undefined filename (e.g., when running from stdin).
  if (filename) {
    const sourceDir = dirname(filename);
    paths.push(join(sourceDir, "extensions"));
    paths.push(sourceDir);
  }

  // Always include compiler's extensions.
  paths.push(compilerExtensionsDir);

  return paths;
}

// Add cross-references: every phase can access every other phase via $.<phaseName>
function attachCrossReferences(lang: Language): void {
  const keys: PhaseKey[] = Object.keys(lang).filter(isPhaseKey);
  for (const phase of keys) {
    for (const other of keys) {
      lang[phase][other] = lang[other];
    }
  }
}

// Resolve an extension name to a file path
// Searches: exact path, then search paths with .us, .ts, .js extensions (in order)
export async function resolveExtension(
  name: string,
  searchPaths: string[] = []
): Promise<string> {
  // If it's already a full path that exists, use it. This allows you to specify `foo.us.js` directly.
  const exists = await fs.exists(name);
  if (exists) {
    return name;
  }

  // Try adding extensions (prefer .us, then .ts, then .js)
  for (const ext of [".us", ".ts", ".js"]) {
    const fullName = name + ext;
    const exists = await fs.exists(fullName);
    if (exists) {
      return fullName;
    }
  }

  // Search in search paths.
  logger.debug(
    `resolving extension ${name} in paths: ${searchPaths.join(", ")}`
  );
  for (const searchPath of searchPaths) {
    for (const ext of ["", ".us", ".ts", ".js"]) {
      const fullPath = join(searchPath, name + ext);
      const exists = await fs.exists(fullPath);
      if (exists) {
        return fullPath;
      }
    }
  }

  throw new Error("Could not resolve extension: " + name);
}

// Extract extension name from file path.
export function extensionNameFromPath(filePath: string): string {
  const base = basename(filePath);
  return base.replace(".us.js", "").replace(".ts", "").replace(".js", "");
}

/**
 * Options for the usc CLI and //usc directives.
 */
export interface DirectiveOptions {
  extensions: string[];
  parse: string; // Which parser to use (e.g., "parse", "customParse")
  compile: string; // Which compiler to use (e.g., "compile", "analyze")
  interpret: string; // Which interpreter to use (e.g., "interpret", "type")
  emit: string; // Which emitter to use
}

const defaultDirectiveOptions = (): DirectiveOptions => ({
  extensions: [],
  parse: "parse",
  compile: "compile",
  emit: "emit",
  interpret: "interpret",
});

/**
 * Parse usc-style arguments from an array of strings; shared
 * between CLI args and //usc directive parsing.
 *
 * The CLI adds additional options that don't make a ton of sense
 * in the //usc directive (like input/output files), so those are
 * not included here.
 */
export function parseUscArgs(args: string[]): DirectiveOptions {
  const opts = defaultDirectiveOptions();

  for (let i = 0; i < args.length; i++) {
    if (
      (args[i] === "-x" || args[i] === "--extension") &&
      i + 1 < args.length
    ) {
      opts.extensions.push(args[++i]);
    } else if (
      (args[i] === "-c" || args[i] === "--compile") &&
      i + 1 < args.length
    ) {
      opts.compile = args[++i];
    } else if (
      args[i] === "-e" ||
      (args[i] === "--emit" && i + 1 < args.length)
    ) {
      opts.emit = args[++i];
    } else if (
      (args[i] === "-i" || args[i] === "--interpret") &&
      i + 1 < args.length
    ) {
      opts.interpret = args[++i];
    }
  }
  return opts;
}

/**
 * Parse a complete usc directive (`//usc ...`) from JS/TS source code.
 */
export function parseUscDirective(source: string): DirectiveOptions {
  const match = source.match(/^\/\/\s*usc\s+(.+)$/m);
  if (!match) {
    return defaultDirectiveOptions();
  }
  return parseUscArgs(match[1].trim().split(/\s+/));
}

// Check that an extension's requirements are satisfied
// Accepts requires as string or string[] for flexibility
function validateRequirements(
  extension: ResolvedExtension,
  extensions: ResolvedExtension[]
): void {
  if (!extension.requires) {
    return;
  }

  // Normalize to array (accept single string for .us files without array syntax)
  // This is just so that Unsound programs can specify `requires` without
  // needing to support arrays well.
  const requires =
    typeof extension.requires === "string"
      ? [extension.requires]
      : extension.requires;
  if (requires.length === 0) {
    return;
  }

  // Check that each required extension is loaded.
  const extensionNames = extensions.map((extension) => extension.name);
  const missing = requires.filter((req) => !extensionNames.includes(req));
  if (missing.length > 0) {
    throw new Error(
      `Extension "${extension.name}" requires [${missing.join(
        ", "
      )}] but they are not loaded. ` +
      `Loaded extensions: [${[...extensionNames].join(", ")}]`
    );
  }
}

// Validate extension name matches file basename
function validateExtensionName(extension: ResolvedExtension): void {
  if (!extension.path) {
    return;
  }

  const expectedName = extensionNameFromPath(extension.path);
  const actualName = extension.name;
  if (actualName !== expectedName) {
    throw new Error(
      `Extension name "${actualName}" does not match file basename "${expectedName}" ` +
      `(from ${extension.path})`
    );
  }
}

// Apply a single extension to a language
// All extensions mutate in place
function applyExtension(
  language: Language,
  extension: ResolvedExtension,
  track: boolean = true
): Language {
  // Validate and check requirements.
  validateExtensionName(extension);
  validateRequirements(extension, language.extensions);

  // Apply phase extensions in pipeline order: pre, parse, compile, analyze, emit, post.
  // Probably this doesn't matter but who knows.
  for (const phase of BUILT_IN_PHASES) {
    const modifier = extension[phase];
    const implementation = language[phase];
    if (modifier) {
      modifier(implementation as any);
    }
  }

  // Apply any other $-phases.
  for (const key of Object.keys(extension) as PhaseKey[]) {
    if (
      key.startsWith("$") &&
      !BUILT_IN_PHASES.includes(key as (typeof BUILT_IN_PHASES)[number])
    ) {
      const builder = extension[key];
      if (builder) {
        // Create empty phase if it doesn't exist yet; because this a custom phase
        // the empty language doesn't have a stub for it.
        if (!language[key]) {
          language[key] = {};
        }
        builder(language[key]);
      }
    }
  }

  // Track loaded extension; we don't track the empty extension (which has no path and
  // is not loadable).
  if (track) {
    language.extensions.push(extension);
  }

  // Re-attach cross-references after any new phases are added
  attachCrossReferences(language);

  return language;
}

/**
 * Given a list of resolved extensions, creates a language with them.
 */
export function createLanguageWithExtensions(
  extensions: ResolvedExtension[] = []
): Language {
  // Start with empty ops; this is not type safe but we don't want to start
  // with the empty extension or we will referentially update it.
  const base: Language = {
    $parse: {} as ParseOps,
    $compile: {} as CompileOps,
    $analyze: {} as AnalyzeOps,
    $emit: {} as EmitOps,
    $interpret: {} as InterpretOps,
    extensions: [],
  };

  // Set up cross-references so every phase can access every other.
  attachCrossReferences(base);

  // Apply empty extension to provide stub implementations; we don't
  // include this in the list of resolved extensions.
  //
  // Because this is always automatically applied, we don't track it
  // in the language's `extensions`.
  //
  // TODO: I suppose we could resolve this properly?
  applyExtension(base, emptyExtension, false);

  // Apply each extension in order.
  return extensions.reduce(
    (lang, extension) => applyExtension(lang, extension),
    base
  );
}

/**
 * Given a list of extensions by name, resolves all extensions and
 * creates a language with them.
 */
export async function createLanguage(
  extensions: string[],
  searchPaths: string[]
): Promise<Language> {
  const resolvedExtensions: ResolvedExtension[] = [];
  for (const extension of extensions) {
    const ext = await loadExtension(extension, searchPaths);
    resolvedExtensions.push(ext);
  }
  return createLanguageWithExtensions(resolvedExtensions);
}

// Load a TypeScript extension
async function loadTsExtension(extPath: string): Promise<Extension> {
  const absPath = resolve(extPath);
  const mod = await import(absPath);
  // If there's a default export that is an object that is probably an extension,
  // use it.
  if (mod.default && typeof mod.default === "object") return mod.default;

  // Otherwise, if the module itself exports things that indicate it is probably
  // an extension, use it.
  if (mod.$parse || mod.$compile || mod.$emit || mod.$interpret) return mod;

  throw new Error(`Could not find extension in ${extPath}`);
}

// Load a .us extension by compiling it with its //usc dependencies
// Caches compiled .us.js based on mtime
// Core is always loaded first (unless the extension itself is core)
async function loadUsExtension(extPath: string): Promise<Extension> {
  const absPath = resolve(extPath);
  const cachedPath = absPath + ".js";

  // Check if cached version exists and is newer than source
  const exists = await fs.exists(cachedPath);
  if (exists) {
    const srcStat = await fs.stat(absPath);
    const cacheStat = await fs.stat(cachedPath);
    if (cacheStat.mtimeMs > srcStat.mtimeMs) {
      // Use cached version
      return loadTsExtension(cachedPath);
    }
  }

  // Need to compile - read source and get its //usc directive
  const source = await fs.readFile(absPath, "utf-8");
  const uscExtensions = parseUscDirective(source).extensions;

  logger.debug(
    `compiling ${basename(absPath)} (requires: ${uscExtensions.join(", ") || "none"
    })`
  );

  // Create a language and compile the source.
  const language = await createLanguage(uscExtensions, getSearchPaths(absPath));
  const js = compileUsToJs(language, source, absPath);
  logger.debug(`  compiled ${basename(absPath)}`);

  // Write compiled source to cache.
  await fs.writeFile(cachedPath, js);

  // Load the compiled version.
  return loadTsExtension(cachedPath);
}

// Compile a .us extension source to a JS module
function compileUsToJs(
  language: Language,
  source: string,
  sourceFile?: string,
  interpretKey: string = "interpret"
): string {
  // Actually use the parser to compile the source.
  const parseResult = language.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(
      source,
      parseResult.pos,
      parseResult.expected
    );
    throw new Error(
      `Parse error in ${sourceFile ? basename(sourceFile) : "input"
      }: \n${formatted} `
    );
  }

  // Compile.
  const ir = language.$compile.compileProgram(parseResult.value);

  // Emit.
  const program = language.$emit.program(ir);

  return getProgramModule(language, program, sourceFile, false, interpretKey);
}

export function getProgramModule(
  language: Language,
  program: string,
  sourceFile?: string,
  printResult: boolean = false,
  interpretKey: string = "interpret"
): string {
  // Generate extension loading code. We need to load the code
  // for each extension so that we can build an interpreter to
  // actually run the program.
  return `// Compiled from ${basename(sourceFile ?? "input")}
  import { createLanguage } from '${resolve(
    import.meta.dirname,
    "extension.ts"
  )}';

const lang = await createLanguage([
  ${language.extensions
      .map((extension) => `'${extension.path ?? extension.name}'`)
      .join(", ")}
]);
const program = ${program.replace("export default ", "").replace(/;$/, "")};
const result = await program(lang.$${interpretKey});
${printResult ? "if (result !== undefined) console.info(result);" : ""}
export default result;
`;
}

/**
 * Loads an extension by name.
 */
export async function loadExtension(
  name: string,
  searchPaths: string[]
): Promise<ResolvedExtension> {
  const resolvedPath = await resolveExtension(name, searchPaths);
  const isUs = resolvedPath.endsWith(".us");
  const extension = isUs
    ? await loadUsExtension(resolvedPath)
    : await loadTsExtension(resolvedPath);
  const resolvedExtension: ResolvedExtension = extension;
  resolvedExtension.path = isUs ? resolvedPath + ".js" : resolvedPath;
  return resolvedExtension;
}

/**
 * Load multiple extensions by name.
 */
export async function loadExtensions(
  names: string[],
  searchPaths: string[]
): Promise<ResolvedExtension[]> {
  const extensions: ResolvedExtension[] = [];
  for (const name of names) {
    const extension = await loadExtension(name, searchPaths);
    extensions.push(extension);
  }
  return extensions;
}

/**
 * Convenience function to run some code through the full pipeline,
 * including interpretation.
 */
export async function run(
  lang: Language,
  source: string,
  interpretKey: string = "interpret"
): Promise<unknown> {
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(
      source,
      parseResult.pos,
      parseResult.expected
    );
    throw new Error(`Parse error: \n${formatted} `);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);
  const closure = lang.$emit.programClosure(ir)({});

  const interpreter = lang[`$${interpretKey} `] as InterpretOps | undefined;
  if (!interpreter) {
    throw new Error(`No interpreter found for key: ${interpretKey} `);
  }

  return await closure(interpreter);
}

/**
 * Convenience function to compile source to JS string.
 * @param lang
 * @param source
 * @returns
 */
export function compileToJS(lang: Language, source: string): string {
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(
      source,
      parseResult.pos,
      parseResult.expected
    );
    throw new Error(`Parse error: \n${formatted} `);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);
  return lang.$emit.program(ir);
}
