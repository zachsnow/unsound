#!/usr/bin/env bun
// usc - Unsound compiler CLI (next-gen)

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLanguage, run, compileToJS, loadExtension as loadExt, parseDefaultExtensions, parseUscArgs, parseUscDirective, resolveExtension, type Extension, type Language, type UscOptions } from './extension.ts';
import { emitString } from './emit.ts';
import { formatParseError, ParseError } from './parse.ts';
import { prettyPrint } from './pretty.ts';

// Detect if running from a compiled binary (bun embeds in /$bunfs/)
const IS_BUNDLED = import.meta.dirname.startsWith('/$bunfs/');

// Track extracted temp directory for cleanup
let extractedSourceDir: string | null = null;

// Write embedded sources to a temp directory and return the path
async function extractEmbeddedSources(): Promise<string> {
  if (extractedSourceDir) {
    return extractedSourceDir;
  }

  // Dynamic import - only loaded when IS_BUNDLED is true
  // Bun will still bundle this since the path is a string literal
  const mod = await import('../embedded-sources.json');
  const embeddedSources: Record<string, string> = mod.default;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usc-sources-'));

  // Create extensions subdirectory
  fs.mkdirSync(path.join(tempDir, 'extensions'), { recursive: true });

  // Write all embedded source files (content is stored as strings)
  for (const [relativePath, content] of Object.entries(embeddedSources)) {
    const destPath = path.join(tempDir, relativePath);
    fs.writeFileSync(destPath, content);
  }

  extractedSourceDir = tempDir;
  return tempDir;
}

// Clean up extracted sources
function cleanupExtractedSources(): void {
  if (extractedSourceDir) {
    fs.rmSync(extractedSourceDir, { recursive: true, force: true });
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

// Get extension search paths - when bundled, include the extracted source directory
async function getExtensionSearchPaths(): Promise<string[]> {
  if (!IS_BUNDLED) {
    return ['src/extensions', '.'];
  }
  const sourceDir = await getSourceDir();
  return [path.join(sourceDir, 'extensions'), sourceDir, 'extensions', '.'];
}

// === Argument Parsing ===

// CLI-specific options extend shared UscOptions
// compile/interpret/emit are required here (have defaults)
type Options = Omit<UscOptions, 'compile' | 'interpret' | 'emit'> & {
  input?: string;
  output?: string;
  compile: string;      // Which compiler key to use (default: "compile")
  emit: string;         // Which emit key to use (default: "emit")
  interpret: string;    // Which interpreter key to use (default: "interpret")
  mode: 'run' | 'module' | 'standalone' | 'binary';
  show: ('ast' | 'ir' | 'js')[];
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
    compile: shared.compile ?? 'compile',      // Default to $compile
    emit: shared.emit ?? 'emit',               // Default to $emit
    interpret: shared.interpret ?? 'interpret', // Default to $interpret
    mode: 'run',
    show: [],
    env: {},
    help: false,
    verbose: false,
  };

  // Parse CLI-specific options
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      i++;
    } else if (arg === '--no-core' || arg === '-x' || arg === '--extension' ||
      arg === '-c' || arg === '--compile' || arg === '-i' || arg === '--interpret' || arg === '--emit') {
      // Already handled by parseUscArgs, skip the value for options with args
      if (arg !== '--no-core') i++;
      i++;
    } else if (arg === '-o' || arg === '--output') {
      opts.output = args[++i];
      i++;
    } else if (arg === '-m' || arg === '--mode') {
      const mode = args[++i];
      if (mode === 'run' || mode === 'module' || mode === 'standalone' || mode === 'binary') {
        opts.mode = mode;
      } else {
        console.error(`Unknown mode: ${mode}`);
        process.exit(1);
      }
      i++;
    } else if (arg === '--ast') {
      opts.show.push('ast');
      i++;
    } else if (arg === '--ir') {
      opts.show.push('ir');
      i++;
    } else if (arg === '--js') {
      opts.show.push('js');
      i++;
    } else if (arg === '-e' || arg === '--env') {
      const [key, value] = args[++i].split('=');
      try {
        opts.env[key] = JSON.parse(value);
      } catch {
        opts.env[key] = value;
      }
      i++;
    } else if (arg === '-v' || arg === '--verbose') {
      opts.verbose = true;
      i++;
    } else if (arg === '-') {
      opts.input = '-';
      i++;
    } else if (!arg.startsWith('-')) {
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
  console.log(`usc - Unsound compiler (next-gen)

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

function generateModule(lang: Language, source: string): string {
  return compileToJS(lang, source);
}

async function generateStandalone(source: string, extNames: string[], noCore: boolean, printResult: boolean = false): Promise<string> {
  // Build language incrementally and compile .us extensions as we go
  let lang = createLanguage([]);
  const searchPaths = await getExtensionSearchPaths();
  if (!noCore) {
    await loadExt('core', lang, searchPaths);
  }

  const sourceDir = await getSourceDir();

  // Collect imports and extension setup
  const imports: string[] = [];
  const tsExtNames: string[] = [];  // Extensions to pass to createLanguage
  const usExtSetup: string[] = [];  // .us extensions need runtime evaluation

  // Core extension
  if (!noCore) {
    imports.push(`import core from '${path.resolve(sourceDir, 'extensions/core.ts')}';`);
    tsExtNames.push('core');
  }

  // Process additional extensions
  for (const name of extNames) {
    const resolvedPath = resolveExtension(name, searchPaths);
    if (!resolvedPath) {
      throw new Error(`Extension not found: ${name}`);
    }

    const absPath = path.resolve(resolvedPath);
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');

    if (resolvedPath.endsWith('.us')) {
      // Compile .us extension to JS using current language
      const extSource = fs.readFileSync(resolvedPath, 'utf-8');
      const extJs = compileToJS(lang, extSource);
      // .us extensions must be evaluated at runtime with the interpreter
      usExtSetup.push(`const ${safeName} = await (${extJs.replace('export default ', '').replace(/;$/, '')})(lang.$interpret);`);
      usExtSetup.push(`applyExtension(lang, ${safeName});`);
      // Load into lang for subsequent extensions
      await loadExt(name, lang, searchPaths);
    } else {
      // .ts/.js extension - import directly
      imports.push(`import ${safeName} from '${absPath}';`);
      tsExtNames.push(safeName);
      await loadExt(name, lang, searchPaths);
    }
  }

  // Compile the main program with the full language
  const programJs = compileToJS(lang, source);

  return `// Generated by usc (Unsound compiler)
import { createLanguage, applyExtension } from '${path.resolve(sourceDir, 'extension.ts')}';
${imports.join('\n')}

const lang = createLanguage([${tsExtNames.join(', ')}]);

${usExtSetup.length > 0 ? '// Runtime-evaluated extensions\n' + usExtSetup.join('\n') : ''}

const $ = lang.$interpret;

const _output = ${programJs.replace('export default ', '').replace(/;$/, '')};

const result = await _output($);
${printResult ? 'if (result !== undefined) console.log(result);' : ''}
export default result;
`;
}

async function generateBinary(source: string, extNames: string[], noCore: boolean, outputPath: string): Promise<void> {
  // Generate standalone JS with result printing enabled
  const standaloneJs = await generateStandalone(source, extNames, noCore, true);

  // Write to a temp file in system temp directory
  const tempFile = path.join(os.tmpdir(), `.usc-standalone-${process.pid}.ts`);
  fs.writeFileSync(tempFile, standaloneJs);

  try {
    // Compile with bun
    const proc = Bun.spawnSync(['bun', 'build', '--compile', tempFile, '--outfile', outputPath], {
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    if (proc.exitCode !== 0) {
      throw new Error(`bun build --compile failed with exit code ${proc.exitCode}`);
    }
  } finally {
    // Clean up temp file and extracted sources
    fs.unlinkSync(tempFile);
    cleanupExtractedSources();
  }
}

// === Main ===

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // Read input
  let source: string;
  if (!opts.input || opts.input === '-') {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    source = Buffer.concat(chunks).toString('utf-8');
  } else {
    source = fs.readFileSync(opts.input, 'utf-8');
  }

  // Parse directive from source to get file defaults
  const directive = parseUscDirective(source);

  // Merge options: CLI explicit > directive > hardcoded defaults
  // For extensions: CLI -x flags override directive (not additive)
  const extNames = opts.extensions.length > 0
    ? opts.extensions
    : directive.extensions;
  const noCore = opts.noCore || directive.noCore;
  const compile = opts.compile !== 'compile' ? opts.compile : (directive.compile ?? 'compile');
  const interpret = opts.interpret !== 'interpret' ? opts.interpret : (directive.interpret ?? 'interpret');
  const emit = opts.emit !== 'emit' ? opts.emit : (directive.emit ?? 'emit');

  // Build language incrementally
  let lang = createLanguage([]);

  const log = opts.verbose ? (msg: string) => console.error(`usc: ${msg}`) : () => { };
  if (opts.verbose) {
    process.env.USC_VERBOSE = '1';
  }

  // Get extension search paths (includes extracted sources when bundled)
  const searchPaths = await getExtensionSearchPaths();

  // Load core extension first (unless --no-core)
  if (!noCore) {
    log('loading extension core');
    await loadExt('core', lang, searchPaths);
  }

  log(`extensions to load: ${extNames.join(', ')}`);

  // Load extensions using search paths
  for (const extName of extNames) {
    try {
      log(`loading extension ${extName}`);
      await loadExt(extName, lang, searchPaths);
      log(`loaded extension ${extName}`);
    } catch (e) {
      console.error(`Failed to load extension ${extName}:`, e);
      process.exit(1);
    }
  }

  // Check that the requested interpreter exists
  const interpKey = `$${interpret}`;
  if (opts.mode === 'run' && !(lang as any)[interpKey]) {
    console.error(`No interpreter '${interpret}' found. Available: ${Object.keys(lang).filter(k => k.startsWith('$') && !['$parse', '$compile', '$emit'].includes(k)).map(k => k.slice(1)).join(', ')
      }`);
    process.exit(1);
  }

  // Inject env into the selected interpreter
  const selectedInterp = (lang as any)[interpKey];
  if (selectedInterp?.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      selectedInterp.env.bind(key, value);
    }
  }

  // Parse
  const parseResult = lang.$parse.program()(source, 0);
  if (!parseResult.ok) {
    console.error(formatParseError(source, parseResult.pos, parseResult.expected));
    process.exit(1);
  }

  // Show AST if requested
  if (opts.show.includes('ast')) {
    console.error('=== AST ===');
    console.error(JSON.stringify(parseResult.value, null, 2));
  }

  // Compile (using specified compile phase)
  const compileKey = `$${compile}`;
  const compiler = (lang as any)[compileKey];

  if (!compiler) {
    console.error(`No compiler '${compile}' found. Available: ${Object.keys(lang).filter(k => k.startsWith('$')).map(k => k.slice(1)).join(', ')
      }`);
    process.exit(1);
  }

  // For non-standard compile phases, output result directly
  if (compile !== 'compile') {
    // Call the appropriate entry point (analyzeProgram for analyze, etc.)
    const entryPoint = compile === 'analyze' ? 'analyzeProgram' : 'compileProgram';
    if (typeof compiler[entryPoint] !== 'function') {
      console.error(`Compiler '${compile}' has no ${entryPoint} method`);
      process.exit(1);
    }

    const result = compiler[entryPoint](parseResult.value);
    console.log(prettyPrint(result, 'auto'));
    process.exit(0);
  }

  // Standard compile path
  const ir = lang.$compile.compileProgram(parseResult.value);

  // Show IR if requested
  if (opts.show.includes('ir')) {
    console.error('=== IR ===');
    console.error(JSON.stringify(ir, null, 2));
  }

  // Show JS if requested
  if (opts.show.includes('js')) {
    console.error('=== JS ===');
    console.error(emitString(ir));
  }

  // Generate output based on mode
  let output: string | undefined;
  let result: unknown;

  switch (opts.mode) {
    case 'module':
      output = generateModule(lang, source);
      break;

    case 'standalone':
      output = await generateStandalone(source, extNames, opts.noCore);
      break;

    case 'binary':
      if (!opts.output) {
        console.error('Binary mode requires -o/--output to specify the output file');
        process.exit(1);
      }
      await generateBinary(source, extNames, opts.noCore, opts.output);
      break;

    case 'run':
      try {
        result = await run(lang, source, interpret);
        if (result !== undefined) {
          console.log(result);
        }
      } catch (e) {
        if (e instanceof ParseError) {
          console.error(e.format(source));
        } else {
          console.error('Runtime error:', e);
        }
        process.exit(1);
      }
      break;
  }

  // Write output
  if (output) {
    if (opts.output) {
      fs.writeFileSync(opts.output, output);
    } else {
      console.log(output);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
