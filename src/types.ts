import { AnalysisResult } from "./analyze";
import { ProgramClosure } from "./emit";
import { ParseResult } from "./parse";

/**
 * Operations for each phase of the language pipeline; these are the operations that
 * the pipeline composer requires be implemented by extensions, in order to actually run.
 *
 * The empty language provides minimalimplementations of each phase.
 */

/**
 * Expected operations for pre-parse phase; in general this will not be overridden as the
 * empty language implements file reading.
 */
export interface PreOps<Out = unknown> {
  read: (filename: string) => Out;
}

/**
 * Expected operations for parse phase.
 */
export interface ParseOps<In = unknown, Out = unknown> {
  program: () => (program: In, pos: number) => ParseResult<Out>;
}

/**
 * Expected operations for compile phase.
 */
export interface CompileOps<In = unknown, Out = unknown> {
  compileProgram: (program: In) => Out;
}

/**
 * Expected operations for emit phase.
 */
export interface EmitOps<In = unknown> {
  program: (program: In) => string;
  programClosure: (program: In) => ProgramClosure;
}

/**
 * Expected operations for post phase; in general this will not be overridden as the
 * empty language implements file writing.
 */
export interface PostOps {
  write: (filename: string, content: string) => void;
}

/**
 * Expected operations for analysis phase.
 */
export interface AnalyzeOps<In = unknown> {
  analyzeProgram: (program: In) => AnalysisResult;
}

/**
 * Expected operations for interpretation phase. This is truly empty as it depends entirely
 * on what the compiler generates.
 */
export interface InterpretOps { }

// Extension metadata
export interface ExtensionMeta {
  name: string;
  description?: string;
  requires?: string | string[]; // Single string or array (for .us files without array syntax)
  version?: string;
}

export type Builder<T> = ($: T) => void;

export type PhaseKey = `$${string}`;

// Extension type - each key is optional
//
// All phases use mutation style (mutate the ops object, return void); this
// essentially allows composition of extensions (as if each extension were
// a class that extends the previous one) without extensions needing to "understand"
// inheritance, prototypes, or classes.
export interface Extension<
  PreParse = unknown,
  ParseCompile = unknown,
  CompileEmit = unknown,
> extends ExtensionMeta {
  $parse?: Builder<ParseOps<PreParse, ParseCompile>>,
  $compile?: Builder<CompileOps<ParseCompile, CompileEmit>>,
  $analyze?: Builder<AnalyzeOps<ParseCompile>>,
  $emit?: Builder<EmitOps<CompileEmit>>,
  $interpret?: Builder<InterpretOps>,

  // Additional interpreters, compilers, etc. (e.g., $type for type checking)
  // Note: index signature must be compatible with all specific properties
  [key: PhaseKey]: Builder<any> | undefined;
}

// A Language is the result of composing extensions
// Supports multiple interpreters via dynamic keys
export interface Language<
  PreParse = unknown,
  ParseCompile = unknown,
  CompileEmit = unknown,
> {
  $parse: ParseOps<PreParse, ParseCompile>;
  $compile: CompileOps<ParseCompile, CompileEmit>;
  $analyze: AnalyzeOps<ParseCompile>;
  $emit: EmitOps<CompileEmit>;
  $interpret: InterpretOps;

  // Loaded extensions.
  extensions: string[];

  // Additional interpreters/phases
  [key: PhaseKey]: any
}
