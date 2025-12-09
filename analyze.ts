// AST analyzer - walks AST to collect definitions, references, diagnostics
// Used by $analyze phase as an alternative "compiler" that produces AnalysisResult

import type { Expr, Span } from './ast.ts';
export interface Definition {
  name: string;
  kind: 'let' | 'param' | 'const';
  loc?: Span;
}

export interface Reference {
  name: string;
  loc?: Span;
  definition?: Definition;  // Resolved reference, if found
}

export interface Diagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info';
  loc?: Span;
}

export interface AnalysisResult {
  definitions: Definition[];
  references: Reference[];
  diagnostics: Diagnostic[];
}

// Scope for tracking definitions
type Scope = Map<string, Definition>;

// Analyze operations - what $ provides for analysis
export interface AnalyzeOps {
  // Main entry point - like compileProgram but produces AnalysisResult
  analyzeProgram: (expr: Expr) => AnalysisResult;

  // Walk an expression (extensions override to handle new node types)
  analyzeExpr: (expr: Expr) => void;

  // Scope management
  pushScope: () => void;
  popScope: () => void;

  // Recording
  define: (name: string, kind: Definition['kind'], loc?: Span) => Definition;
  reference: (name: string, loc?: Span) => void;
  diagnostic: (message: string, severity: Diagnostic['severity'], loc?: Span) => void;

  // State (accessible for inspection)
  definitions: Definition[];
  references: Reference[];
  diagnostics: Diagnostic[];

  // Builtins that shouldn't trigger "undefined" warnings
  builtins: Set<string>;
}

// Build analyzer ops - mutation style like other phases
export function build$analyze($: AnalyzeOps): void {
  // State
  $.definitions = [];
  $.references = [];
  $.diagnostics = [];
  $.builtins = new Set(['$operators']);

  // Scope stack
  const scopes: Scope[] = [new Map()];

  $.pushScope = () => {
    scopes.push(new Map());
  };

  $.popScope = () => {
    scopes.pop();
  };

  $.define = (name, kind, loc) => {
    const def: Definition = { name, kind, loc };
    $.definitions.push(def);
    // Add to current scope
    scopes[scopes.length - 1].set(name, def);
    return def;
  };

  // Resolve a name through scope chain
  const resolve = (name: string): Definition | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const def = scopes[i].get(name);
      if (def) return def;
    }
    return undefined;
  };

  $.reference = (name, loc) => {
    const definition = resolve(name);
    $.references.push({ name, loc, definition });

    // Warn about undefined references (unless builtin)
    if (!definition && !$.builtins.has(name)) {
      $.diagnostic(`Cannot find name '${name}'`, 'error', loc);
    }
  };

  $.diagnostic = (message, severity, loc) => {
    $.diagnostics.push({ message, severity, loc });
  };

  // Main entry point
  $.analyzeProgram = (expr) => {
    // Reset state
    $.definitions = [];
    $.references = [];
    $.diagnostics = [];
    scopes.length = 1;
    scopes[0].clear();

    // Walk the AST
    $.analyzeExpr(expr);

    return {
      definitions: $.definitions,
      references: $.references,
      diagnostics: $.diagnostics,
    };
  };

  // Walk expressions - extensions can override for new node types
  $.analyzeExpr = (expr) => {
    switch (expr.type) {
      case 'Literal':
        // Nothing to analyze
        break;

      case 'Ident':
        $.reference(expr.name, expr.loc);
        break;

      case 'LetExpr':
        // Analyze value first (before name is in scope for non-recursive)
        // Actually, for letrec semantics, define first
        const def = $.define(expr.name, 'let', expr.nameLoc ?? expr.loc);
        $.analyzeExpr(expr.value);
        $.analyzeExpr(expr.body);
        break;

      case 'Lambda':
        $.pushScope();
        // Define parameters
        for (let i = 0; i < expr.params.length; i++) {
          const paramLoc = expr.paramsLoc?.[i];
          $.define(expr.params[i], 'param', paramLoc);
        }
        $.analyzeExpr(expr.body);
        $.popScope();
        break;

      case 'App':
        $.analyzeExpr(expr.fn);
        for (const arg of expr.args) {
          $.analyzeExpr(arg);
        }
        break;

      case 'IfExpr':
        $.analyzeExpr(expr.cond);
        $.analyzeExpr(expr.then);
        $.analyzeExpr(expr.else);
        break;

      case 'ObjectExpr':
        for (const prop of expr.properties) {
          $.analyzeExpr(prop.value);
        }
        break;

      case 'Index':
        $.analyzeExpr(expr.object);
        $.analyzeExpr(expr.key);
        break;

      case 'SetIndex':
        $.analyzeExpr(expr.object);
        $.analyzeExpr(expr.key);
        $.analyzeExpr(expr.value);
        break;

      default:
        // Unknown node type - extensions may have added it
        // They should override analyzeExpr to handle it
        break;
    }
  };
}

// Convenience: create analyzer
export function createAnalyzer(): AnalyzeOps {
  const $ = {} as AnalyzeOps;
  build$analyze($);
  return $;
}
