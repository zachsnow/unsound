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
import type {
  PreOps,
  CompileOps,
  AnalyzeOps,
  EmitOps,
  PostOps,
  Extension,
  Language,
  InterpretOps,
  ParseOps,
  PhaseKey,
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
  const keys = Object.keys(lang).filter((k) => k.startsWith("$"));
  for (const phase of keys) {
    for (const other of keys) {
      (lang[phase as keyof Language] as any)[other] =
        lang[other as keyof Language];
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

  // Search in search paths
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

// Extract extension name from file path
export function extensionNameFromPath(filePath: string): string {
  const base = basename(filePath);
  // Remove .us, .ts, or .js extension
  return base.replace(/\.(us|ts|js)$/, "");
}

// Shared usc options - used by both CLI and //usc directive
export interface UscOptions {
  extensions: string[];
  noCore: boolean;
  parse?: string; // Which parser to use (e.g., "parse", "customParse")
  compile?: string; // Which compiler to use (e.g., "compile", "analyze")
  interpret?: string; // Which interpreter to use (e.g., "interpret", "type")
  emit?: string; // Which emitter to use
}

// Parse usc-style arguments from an array of strings
// Shared between CLI args and //usc directive parsing
export function parseUscArgs(args: string[]): UscOptions {
  const opts: UscOptions = { extensions: [], noCore: false };
  for (let i = 0; i < args.length; i++) {
    if (
      (args[i] === "-x" || args[i] === "--extension") &&
      i + 1 < args.length
    ) {
      opts.extensions.push(args[++i]);
    } else if (args[i] === "--no-core") {
      opts.noCore = true;
    } else if (
      (args[i] === "-c" || args[i] === "--compile") &&
      i + 1 < args.length
    ) {
      opts.compile = args[++i];
    } else if (
      (args[i] === "-i" || args[i] === "--interpret") &&
      i + 1 < args.length
    ) {
      opts.interpret = args[++i];
    } else if (args[i] === "--emit" && i + 1 < args.length) {
      opts.emit = args[++i];
    }
  }

  return opts;
}

export function getExtensions(options: UscOptions): string[] {
  const extensions = [...options.extensions];
  if (!options.noCore && !extensions.includes("core")) {
    extensions.unshift("core");
  }
  return options.extensions;
}

// Parse the full //usc directive including all options
// Format: //usc --no-core -x meso -x const
export function parseUscDirective(source: string): UscOptions {
  const match = source.match(/^\/\/\s+usc\s+(.+)$/m);
  if (!match) return { extensions: [], noCore: false };
  return parseUscArgs(match[1].trim().split(/\s+/));
}

// Check that an extension's requirements are satisfied
// Accepts requires as string or string[] for flexibility
function checkRequirements(
  ext: Extension,
  extensions: string[],
  extPath: string
): void {
  if (!ext.requires) return;

  // Normalize to array (accept single string for .us files without array syntax)
  const requires =
    typeof ext.requires === "string" ? [ext.requires] : ext.requires;
  if (requires.length === 0) return;

  const missing = requires.filter((req) => !extensions.includes(req));
  if (missing.length > 0) {
    const extName = ext.name || extensionNameFromPath(extPath);
    throw new Error(
      `Extension "${extName}" requires [${missing.join(
        ", "
      )}] but they are not loaded. ` +
      `Loaded extensions: [${[...extensions].join(", ")}]`
    );
  }
}

// Validate extension name matches file basename
function validateExtensionName(ext: Extension, filePath: string): void {
  if (!ext.name) return; // No name specified, skip validation

  const expectedName = extensionNameFromPath(filePath);
  if (ext.name !== expectedName) {
    throw new Error(
      `Extension name "${ext.name}" does not match file basename "${expectedName}" ` +
      `(from ${filePath})`
    );
  }
}

// Apply a single extension to a language
// All extensions mutate in place
function applyExtension(
  lang: Language,
  ext: Extension,
  filePath?: string
): Language {
  // Validate and check requirements
  if (filePath) {
    validateExtensionName(ext, filePath);
  }
  checkRequirements(ext, lang.extensions, filePath || "unknown");

  // Apply phase extensions in pipeline order: pre, parse, compile, analyze, emit, post
  for (const phase of BUILT_IN_PHASES) {
    const modifier = ext[phase];
    const implementation = lang[phase];
    if (modifier) {
      modifier(implementation as any);
    }
  }

  // Apply any other $-phases.
  for (const key of Object.keys(ext) as PhaseKey[]) {
    if (
      key.startsWith("$") &&
      !BUILT_IN_PHASES.includes(key as (typeof BUILT_IN_PHASES)[number])
    ) {
      const builder = ext[key];
      if (builder) {
        // Create empty phase if it doesn't exist yet.
        if (!lang[key]) {
          lang[key] = {};
        }
        builder(lang[key]);
      }
    }
  }

  // Track loaded extension
  lang.extensions.push(ext.name);

  // Re-attach cross-references after any new phases are added
  attachCrossReferences(lang);

  return lang;
}

/**
 * Given a list of resolved extensions, creates a language with them.
 */
export function createLanguageWithExtensions(
  extensions: Extension[] = []
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

  // Apply empty extension to provide stub implementations.
  applyExtension(base, emptyExtension);

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
  const loadedExtensions: Extension[] = [];
  for (const extension of extensions) {
    const ext = await loadExtension(extension, searchPaths);
    loadedExtensions.push(ext);
  }
  return createLanguageWithExtensions(loadedExtensions);
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
  const js = compileUsToJs(language, source, absPath, uscExtensions);
  logger.debug(`  compiled ${basename(absPath)}`);

  // Write compiled source to cache.
  await fs.writeFile(cachedPath, js);

  // Load the compiled version.
  return loadTsExtension(cachedPath);
}

// Compile a .us extension source to a JS module
function compileUsToJs(
  lang: Language,
  source: string,
  absPath: string,
  uscExtensions: string[]
): string {
  // Actually use the parser to compile the source.
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(
      source,
      parseResult.pos,
      parseResult.expected
    );
    throw new Error(`Parse error in ${basename(absPath)}:\n${formatted}`);
  }

  // Emit the compiled IR.
  const ir = lang.$compile.compileProgram(parseResult.value);
  const programJs = lang.$emit.program(ir);

  // Generate extension loading code. We need to load the code
  // for each extension so that we can build an interpreter to
  // actually run the program.
  return `// Compiled from ${basename(absPath)}
import { createLanguage } from '${resolve(
    import.meta.dirname,
    "extension.ts"
  )}';

const lang = await createLanguage([
  ${uscExtensions.map((name) => `'${name}'`).join(", ")}
]);
const program = ${programJs.replace("export default ", "").replace(/;$/, "")};
const result = await program(lang.$interpret);

export default result;
`;
}

/**
 * Loads an extension by name.
 */
export async function loadExtension(
  name: string,
  searchPaths: string[]
): Promise<Extension> {
  const resolvedPath = await resolveExtension(name, searchPaths);
  const ext = resolvedPath.endsWith(".us")
    ? await loadUsExtension(resolvedPath)
    : await loadTsExtension(resolvedPath);

  return ext;
}

/**
 * Load multiple extensions by name.
 */
export async function loadExtensions(
  names: string[],
  searchPaths: string[]
): Promise<Extension[]> {
  const extensions: Extension[] = [];
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
  interpretKey: string = "interpret",
): Promise<unknown> {
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(
      source,
      parseResult.pos,
      parseResult.expected
    );
    throw new Error(`Parse error:\n${formatted}`);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);
  const closure = lang.$emit.programClosure(ir)({});

  const interpreter = lang[`$${interpretKey}`] as InterpretOps | undefined;
  if (!interpreter) {
    throw new Error(`No interpreter found for key: ${interpretKey}`);
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
    throw new Error(`Parse error:\n${formatted}`);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);
  return lang.$emit.program(ir);
}
