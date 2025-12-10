#!/usr/bin/env bun
// usc - Unsound compiler CLI (next-gen)

import fs from 'fs';
import path from 'path';
import { createLanguage, run, compileToJS, loadExtension as loadExt, parseDefaultExtensions, resolveExtension, type Extension, type Language } from './extension.ts';
import { emitString } from './emit.ts';
import { formatParseError, ParseError } from './parse.ts';
import { prettyPrint } from './pretty.ts';

// === Argument Parsing ===

interface Options {
  input?: string;
  output?: string;
  extensions: string[];
  noCore: boolean;      // Skip loading core extension
  compile: string;      // Which compiler key to use (default: "compile")
  emit: string;         // Which emit key to use (default: "emit")
  interpret: string;    // Which interpreter key to use (default: "interpret")
  mode: 'run' | 'module' | 'standalone' | 'binary';
  show: ('ast' | 'ir' | 'js')[];
  env: Record<string, unknown>;
  help: boolean;
  verbose: boolean;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    extensions: [],
    noCore: false,
    compile: 'compile',      // Default to $compile
    emit: 'emit',            // Default to $emit
    interpret: 'interpret',  // Default to $interpret
    mode: 'run',
    show: [],
    env: {},
    help: false,
    verbose: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      i++;
    } else if (arg === '--no-core') {
      opts.noCore = true;
      i++;
    } else if (arg === '-x' || arg === '--extension') {
      opts.extensions.push(args[++i]);
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
    } else if (arg === '-c' || arg === '--compile') {
      opts.compile = args[++i];
      i++;
    } else if (arg === '--emit') {
      opts.emit = args[++i];
      i++;
    } else if (arg === '-i' || arg === '--interpret') {
      opts.interpret = args[++i];
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
  if (!noCore) {
    await loadExt('core', lang);
  }

  const extParts: string[] = [];
  const extSetupParts: string[] = [];

  // Resolve and process each extension
  for (let i = 0; i < extNames.length; i++) {
    const name = extNames[i];
    const resolvedPath = resolveExtension(name);
    if (!resolvedPath) {
      throw new Error(`Extension not found: ${name}`);
    }

    const absPath = path.resolve(resolvedPath);

    if (resolvedPath.endsWith('.us')) {
      // Compile .us extension to JS using current language
      const extSource = fs.readFileSync(resolvedPath, 'utf-8');
      const extJs = compileToJS(lang, extSource);
      // Embed as an async function that returns the extension
      extParts.push(`const ext${i} = await (${extJs.replace('export default ', '').replace(/;$/, '')})(lang.$interpret);`);
      extSetupParts.push(`applyExtension(lang, ext${i});`);
      // Also load it into lang for subsequent extensions
      await loadExt(name, lang);
    } else {
      // .ts/.js extension - import directly
      extParts.push(`import ext${i}Module from '${absPath}';`);
      extParts.push(`const ext${i} = ext${i}Module.default || ext${i}Module;`);
      extSetupParts.push(`applyExtension(lang, ext${i});`);
      // Also load it into lang for subsequent extensions
      await loadExt(name, lang);
    }
  }

  // Now compile the main program with the full language
  const js = compileToJS(lang, source);

  // Separate imports from inline code
  const tsImports = extParts.filter(p => p.startsWith('import '));
  const inlineCode = extParts.filter(p => !p.startsWith('import '));

  return `// Generated by usc (Unsound compiler)
import { createLanguage, applyExtension, loadExtension } from '${path.resolve(import.meta.dirname, 'extension.ts')}';
${tsImports.join('\n')}

const lang = createLanguage([]);
${noCore ? '' : "await loadExtension('core', lang);"}

// Load extensions
${inlineCode.join('\n')}
${extSetupParts.join('\n')}

// Run program
const program = ${js.replace('export default ', '').replace(/;$/, '')}
const result = await program(lang.$interpret);
${printResult ? 'if (result !== undefined) console.log(result);' : ''}
export default result;
`;
}

async function generateBinary(source: string, extNames: string[], noCore: boolean, outputPath: string): Promise<void> {
  // Generate standalone JS with result printing enabled
  const standaloneJs = await generateStandalone(source, extNames, noCore, true);

  // Write to a temp file
  const tempFile = path.join(import.meta.dirname, '.tmp-standalone.ts');
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
    // Clean up temp file
    fs.unlinkSync(tempFile);
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

  // Build language incrementally
  let lang = createLanguage([]);

  const log = opts.verbose ? (msg: string) => console.error(`usc: ${msg}`) : () => { };
  if (opts.verbose) {
    process.env.USC_VERBOSE = '1';
  }

  // Load core extension first (unless --no-core)
  if (!opts.noCore) {
    log('loading extension core');
    await loadExt('core', lang);
  }

  // Determine which extensions to load:
  // - CLI -x flags override file defaults
  // - If no CLI flags, use //usc directive from source
  const extNames = opts.extensions.length > 0
    ? opts.extensions
    : parseDefaultExtensions(source);

  log(`extensions to load: ${extNames.join(', ')}`);

  // Load extensions using search paths
  for (const extName of extNames) {
    try {
      log(`loading extension ${extName}`);
      await loadExt(extName, lang);
      log(`loaded extension ${extName}`);
    } catch (e) {
      console.error(`Failed to load extension ${extName}:`, e);
      process.exit(1);
    }
  }

  // Check that the requested interpreter exists
  const interpKey = `$${opts.interpret}`;
  if (opts.mode === 'run' && !(lang as any)[interpKey]) {
    console.error(`No interpreter '${opts.interpret}' found. Available: ${Object.keys(lang).filter(k => k.startsWith('$') && !['$parse', '$compile', '$emit'].includes(k)).map(k => k.slice(1)).join(', ')
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
  const compileKey = `$${opts.compile}`;
  const compiler = (lang as any)[compileKey];

  if (!compiler) {
    console.error(`No compiler '${opts.compile}' found. Available: ${Object.keys(lang).filter(k => k.startsWith('$')).map(k => k.slice(1)).join(', ')
      }`);
    process.exit(1);
  }

  // For non-standard compile phases, output result directly
  if (opts.compile !== 'compile') {
    // Call the appropriate entry point (analyzeProgram for analyze, etc.)
    const entryPoint = opts.compile === 'analyze' ? 'analyzeProgram' : 'compileProgram';
    if (typeof compiler[entryPoint] !== 'function') {
      console.error(`Compiler '${opts.compile}' has no ${entryPoint} method`);
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
        result = await run(lang, source, opts.interpret);
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
