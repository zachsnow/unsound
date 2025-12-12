// Extensions for next-gen Unsound
//
// An extension is an object with optional $parse, $compile, $emit, $interpret keys.
// Each is a builder function that takes the base implementation and returns an extended one.
//
// Extensions can include metadata:
//   name: string        - Must match file basename (e.g., "meso" for meso.us)
//   description: string - Human-readable description
//   requires: string[]  - Names of required extensions (must be loaded first)
//   version: string     - Semantic version

import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { ParseError, formatParseError, type ParserOps } from "./parse.ts";
import type { CompilerOps } from './compile.ts';
import { createInterpret, type InterpretOps, type Env } from './interpret.ts';
import { type AnalyzeOps } from './analyze.ts';
import { PreOps } from './pre.ts';
import { EmitOps } from './emit.ts';
import { PostOps } from './post.ts';
import { emptyExtension } from './empty.ts';

// Re-export types for convenience
export type { InterpretOps, Env, PreOps, PostOps, EmitOps, AnalyzeOps, ParserOps, CompilerOps };

// Extension metadata
export interface ExtensionMeta {
  name: string;
  description?: string;
  requires?: string | string[];  // Single string or array (for .us files without array syntax)
  version?: string;
}

// Extension type - each key is optional
// All phases use mutation style (mutate the ops object, return void)
export interface Extension extends Partial<ExtensionMeta> {
  $pre?: ($: PreOps) => void;
  $parse?: ($: ParserOps) => void;
  $compile?: ($: CompilerOps) => void;
  $analyze?: ($: AnalyzeOps) => void;
  $emit?: ($: EmitOps) => void;
  $post?: ($: PostOps) => void;
  $interpret?: ($: InterpretOps) => void;

  // Additional interpreters, compilers, etc. (e.g., $type for type checking)
  // Note: index signature must be compatible with all specific properties
  [key: `$${string}`]: (($: any) => void) | undefined;
}

// A Language is the result of composing extensions
// Supports multiple interpreters via dynamic keys
export interface Language {
  $pre: PreOps;
  $parse: ParserOps;
  $compile: CompilerOps;
  $analyze: AnalyzeOps;
  $emit: EmitOps;
  $post: PostOps;
  $interpret: InterpretOps;
  // Track loaded extension names for dependency checking
  _loadedExtensions: Set<string>;
  // Additional interpreters/phases
  [key: `$${string}`]: InterpretOps | ParserOps | CompilerOps | AnalyzeOps | EmitOps | PreOps | PostOps | undefined;
}

// Default extension search paths (relative to cwd)
const DEFAULT_SEARCH_PATHS = [
  'extensions',
  '.',
];

// Add cross-references: every phase can access every other phase via $.<phaseName>
function attachCrossReferences(lang: Language): void {
  const keys = Object.keys(lang).filter(k => k.startsWith('$'));
  for (const phase of keys) {
    for (const other of keys) {
      (lang[phase as keyof Language] as any)[other] = lang[other as keyof Language];
    }
  }
}

// Resolve an extension name to a file path
// Searches: exact path, then search paths with .us, .ts, .js extensions (in order)
export function resolveExtension(name: string, searchPaths: string[] = DEFAULT_SEARCH_PATHS): string | null {
  // If it's already a full path that exists, use it
  if (existsSync(name)) {
    return name;
  }

  // Try adding extensions (prefer .us, then .ts, then .js)
  for (const ext of ['.us', '.ts', '.js']) {
    if (existsSync(name + ext)) {
      return name + ext;
    }
  }

  // Search in search paths
  for (const searchPath of searchPaths) {
    for (const ext of ['', '.us', '.ts', '.js']) {
      const fullPath = join(searchPath, name + ext);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

// Extract extension name from file path
export function extensionNameFromPath(filePath: string): string {
  const base = basename(filePath);
  // Remove .us, .ts, or .js extension
  return base.replace(/\.(us|ts|js)$/, '');
}

// Shared usc options - used by both CLI and //usc directive
export interface UscOptions {
  extensions: string[];
  noCore: boolean;
  compile?: string;    // Which compiler to use (e.g., "compile", "analyze")
  interpret?: string;  // Which interpreter to use (e.g., "interpret", "type")
  emit?: string;       // Which emitter to use
}

// Parse usc-style arguments from an array of strings
// Shared between CLI args and //usc directive parsing
export function parseUscArgs(args: string[]): UscOptions {
  const opts: UscOptions = { extensions: [], noCore: false };
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-x' || args[i] === '--extension') && i + 1 < args.length) {
      opts.extensions.push(args[++i]);
    } else if (args[i] === '--no-core') {
      opts.noCore = true;
    } else if ((args[i] === '-c' || args[i] === '--compile') && i + 1 < args.length) {
      opts.compile = args[++i];
    } else if ((args[i] === '-i' || args[i] === '--interpret') && i + 1 < args.length) {
      opts.interpret = args[++i];
    } else if (args[i] === '--emit' && i + 1 < args.length) {
      opts.emit = args[++i];
    }
  }
  return opts;
}

// Parse the //usc directive from source to get default extensions
// Format: //usc -x meso -x const
export function parseDefaultExtensions(source: string): string[] {
  return parseUscDirective(source).extensions;
}

// Parse the full //usc directive including all options
// Format: //usc --no-core -x meso -x const
export function parseUscDirective(source: string): UscOptions {
  const match = source.match(/^\/\/usc\s+(.+)$/m);
  if (!match) return { extensions: [], noCore: false };
  return parseUscArgs(match[1].trim().split(/\s+/));
}

// Check that an extension's requirements are satisfied
// Accepts requires as string or string[] for flexibility
function checkRequirements(ext: Extension, loadedExtensions: Set<string>, extPath: string): void {
  if (!ext.requires) return;

  // Normalize to array (accept single string for .us files without array syntax)
  const requires = typeof ext.requires === 'string' ? [ext.requires] : ext.requires;
  if (requires.length === 0) return;

  const missing = requires.filter(req => !loadedExtensions.has(req));
  if (missing.length > 0) {
    const extName = ext.name || extensionNameFromPath(extPath);
    throw new Error(
      `Extension "${extName}" requires [${missing.join(', ')}] but they are not loaded. ` +
      `Loaded extensions: [${[...loadedExtensions].join(', ')}]`
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
export function applyExtension(lang: Language, ext: Extension, filePath?: string): Language {
  // Validate and check requirements
  if (filePath) {
    validateExtensionName(ext, filePath);
  }
  checkRequirements(ext, lang._loadedExtensions, filePath || 'unknown');

  // Apply phase extensions in pipeline order: pre, parse, compile, emit, post
  if (ext.$pre) {
    ext.$pre(lang.$pre);
  }
  if (ext.$parse) {
    ext.$parse(lang.$parse);
  }
  if (ext.$compile) {
    ext.$compile(lang.$compile);
  }
  if (ext.$emit) {
    ext.$emit(lang.$emit);
  }
  if (ext.$post) {
    ext.$post(lang.$post);
  }

  // Apply $analyze if present
  if (ext.$analyze) {
    ext.$analyze(lang.$analyze);
  }

  // Apply all interpreter extensions (any key starting with $ that's not a core phase)
  const corePhases = ['$pre', '$parse', '$compile', '$analyze', '$emit', '$post'];
  for (const key of Object.keys(ext)) {
    if (key.startsWith('$') && !corePhases.includes(key)) {
      const builder = ext[key as keyof Extension] as (($: InterpretOps) => void) | undefined;
      if (builder) {
        // Create interpreter if it doesn't exist yet
        if (!lang[key as keyof Language]) {
          (lang as any)[key] = createInterpret();
        }
        builder(lang[key as keyof Language] as InterpretOps);
      }
    }
  }

  // Track loaded extension
  const extName = ext.name || (filePath ? extensionNameFromPath(filePath) : undefined);
  if (extName) {
    lang._loadedExtensions.add(extName);
  }

  // Re-attach cross-references after any new phases are added
  attachCrossReferences(lang);

  return lang;
}

// Create a language from a list of extensions
// Always starts with the empty extension which provides stub implementations
export function createLanguage(extensions: Extension[] = []): Language {
  // Start with empty ops
  const base: Language = {
    $pre: {} as PreOps,
    $parse: {} as ParserOps,
    $compile: {} as CompilerOps,
    $analyze: {} as AnalyzeOps,
    $emit: {} as EmitOps,
    $post: {} as PostOps,
    $interpret: {} as InterpretOps,
    _loadedExtensions: new Set(),
  };

  // Set up cross-references so every phase can access every other
  attachCrossReferences(base);

  // Apply empty extension first to provide stub implementations
  applyExtension(base, emptyExtension);

  return extensions.reduce((lang, ext) => applyExtension(lang, ext), base);
}

// Load a TypeScript extension
async function loadTsExtension(extPath: string): Promise<Extension> {
  const absPath = resolve(extPath);
  const mod = await import(absPath);
  if (mod.default && typeof mod.default === 'object') return mod.default;
  if (mod.extension && typeof mod.extension === 'object') return mod.extension;
  if (mod.fullExtension && typeof mod.fullExtension === 'object') return mod.fullExtension;
  if (mod.$parse || mod.$compile || mod.$emit || mod.$interpret) return mod;
  throw new Error(`Could not find extension in ${extPath}`);
}

// Load a .us extension by compiling it with its //usc dependencies
// Caches compiled .us.js based on mtime
// Core is always loaded first (unless the extension itself is core)
async function loadUsExtension(extPath: string, _lang: Language): Promise<Extension> {
  const absPath = resolve(extPath);
  const cachedPath = absPath + '.js';

  // Check if cached version exists and is newer than source
  if (existsSync(cachedPath)) {
    const srcStat = statSync(absPath);
    const cacheStat = statSync(cachedPath);
    if (cacheStat.mtimeMs > srcStat.mtimeMs) {
      // Use cached version
      return loadTsExtension(cachedPath);
    }
  }

  // Need to compile - read source and get its //usc directive
  const source = readFileSync(absPath, 'utf-8');
  const uscExtensions = parseDefaultExtensions(source);

  const verbose = process.env.USC_VERBOSE === '1';
  const log = verbose ? (msg: string) => console.error(`usc: ${msg}`) : () => { };

  log(`compiling ${basename(absPath)} (requires: ${uscExtensions.join(', ') || 'none'})`);

  // Build a language for compiling this extension
  // Always start with core (provides parser, compiler, etc.)
  const compileLang = createLanguage([]);
  await loadExtension('core', compileLang);

  // Load the //usc extensions (may recursively compile other .us files)
  for (const extName of uscExtensions) {
    log(`  loading dependency ${extName} for ${basename(absPath)}`);
    await loadExtension(extName, compileLang);
  }

  log(`  parsing ${basename(absPath)}`);
  // Debug: binary search for parse failure
  if (verbose) {
    const lines = source.split('\n');
    let lo = 0, hi = lines.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const partial = lines.slice(0, mid + 1).join('\n');
      const result = compileLang.$parse.program()(partial, 0);
      if (result.ok) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    log(`  first failing line: ${lo + 1}`);
    if (lo < lines.length) {
      log(`  line content: ${lines[lo]}`);
    }
  }
  // Compile to JS
  const js = compileUsToJs(compileLang, source, absPath, uscExtensions);
  log(`  compiled ${basename(absPath)}`);

  // Write cache
  writeFileSync(cachedPath, js);

  // Load the compiled version
  return loadTsExtension(cachedPath);
}

// Compile a .us extension source to a JS module
function compileUsToJs(lang: Language, source: string, absPath: string, uscExtensions: string[]): string {
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(source, parseResult.pos, parseResult.expected);
    throw new Error(`Parse error in ${basename(absPath)}:\n${formatted}`);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);
  const programJs = lang.$emit.programString(ir);

  // Generate extension loading code (core is always loaded first)
  const extLoads = uscExtensions.map(name => `await loadExtension('${name}', lang);`);

  return `// Compiled from ${basename(absPath)}
import { createLanguage, loadExtension } from '${resolve(import.meta.dirname, 'extension.ts')}';

const lang = createLanguage([]);
await loadExtension('core', lang);
${extLoads.join('\n')}

const program = ${programJs.replace('export default ', '').replace(/;$/, '')};
const result = await program(lang.$interpret);

export default result;
`;
}

// Load and apply an extension by name or path
export async function loadExtension(
  nameOrPath: string,
  lang: Language,
  searchPaths: string[] = DEFAULT_SEARCH_PATHS
): Promise<Extension> {
  const resolvedPath = resolveExtension(nameOrPath, searchPaths);
  if (!resolvedPath) {
    throw new Error(`Extension not found: ${nameOrPath} (searched: ${searchPaths.join(', ')})`);
  }

  const ext = resolvedPath.endsWith('.us')
    ? await loadUsExtension(resolvedPath, lang)
    : await loadTsExtension(resolvedPath);

  applyExtension(lang, ext, resolvedPath);
  return ext;
}

// Load multiple extensions by name
export async function loadExtensions(
  names: string[],
  lang: Language,
  searchPaths: string[] = DEFAULT_SEARCH_PATHS
): Promise<void> {
  for (const name of names) {
    await loadExtension(name, lang, searchPaths);
  }
}

// Convenience: run source through the full pipeline
export async function run(lang: Language, source: string, interpretKey: string = 'interpret'): Promise<unknown> {
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(source, parseResult.pos, parseResult.expected);
    throw new Error(`Parse error:\n${formatted}`);
  }

  const interpreter = lang[`$${interpretKey}` as keyof Language] as InterpretOps | undefined;
  if (!interpreter) {
    throw new Error(`No interpreter found for key: ${interpretKey}`);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);
  const closure = lang.$emit.programClosure(ir)({});
  return await (closure as Function)(interpreter);
}

// Convenience: compile source to JS string
export function compileToJS(lang: Language, source: string): string {
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    const formatted = formatParseError(source, parseResult.pos, parseResult.expected);
    throw new Error(`Parse error:\n${formatted}`);
  }

  const ir = lang.$compile.compileProgram(parseResult.value);
  return lang.$emit.programString(ir);
}
