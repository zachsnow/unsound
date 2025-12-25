// AST analyzer - walks AST to collect definitions, references, diagnostics
// Used by $analyze phase as an alternative "compiler" that produces AnalysisResult

import type { AppExpr, AssignIndexExpr, Expr, IdentifierExpr, IfExpr, IndexExpr, LambdaExpr, LetExpr, LiteralExpr, ObjectExpr, Span } from './ast.ts';

/**
 * A definition of a name in the program.
 *
 * Extensions may create additional kinds, in which case they should always
 * include `name` and `loc` (if available).
 */
export interface Definition {
  name: string;
  kind: 'let' | 'param' | 'const';
  loc?: Span;
}

/**
 * A reference to a definition, if resolved.
 */
export interface Reference {
  name: string;
  loc?: Span;
  definition?: Definition;  // Resolved reference, if found
}

/**
 * A compiler diagnostic, that the IDE can show to the user.
 */
export interface Diagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info';
  loc?: Span;
}

/**
 * A semantic tokens for syntax highlighting; these types can be extended by
 * language extensions.
 */
type TokenType =
  | 'keyword' | 'variable' | 'parameter' | 'function'
  | 'number' | 'string' | 'operator' | 'property' | 'type';

/**
 * In Unsound everything is a declaration for now.
 */
type TokenModifier = 'declaration' | 'definition' | 'readonly';

/**
 * Semantic information for tokens, used when highlighting.
 */
export interface SemanticToken {
  loc: Span;
  type: TokenType;
  modifiers?: TokenModifier[];
}

/**
 * The result of analyzing a program; this is what `$analyze` produces.
 */
export interface AnalysisResult {
  definitions: Definition[];
  references: Reference[];
  diagnostics: Diagnostic[];
  tokens: SemanticToken[];
}

/**
 * A stack-based environment for name resolution.
 *
 * When compiling a program we model the environment as a stack of scopes,
 * pushing scopes as we enter nested lambdas.
 */
class Environment {
  private scopes: Record<string, Definition>[] = [];

  public push() {
    this.scopes.push({});
  }
  public pop() {
    this.scopes.pop();
  }

  public define(name: string, def: Definition) {
    if (this.scopes.length === 0) {
      throw new Error('No scope to define in');
    }
    this.scopes[this.scopes.length - 1][name] = def;
  }

  public resolve(name: string): Definition | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const def = this.scopes[i][name];
      if (def) return def;
    }
    return undefined;
  }
};

/**
 * Operations for analyzing a program; while the
 */
export interface AnalyzeOps {
  environment: Environment;

  // Main entry point - like compileProgram but produces AnalysisResult
  analyzeProgram: (expr: Expr) => AnalysisResult;

  // Walk an expression (extensions override to handle new node types)
  analyzeExpr: (expr: Expr) => void;
  analyzeLiteral: (expr: LiteralExpr) => void;
  analyzeIdentifier: (expr: IdentifierExpr) => void;
  analyzeLet: (expr: LetExpr) => void;
  analyzeLambda: (expr: LambdaExpr) => void;
  analyzeApp: (expr: AppExpr) => void;
  analyzeIf: (expr: IfExpr) => void;
  analyzeObject: (expr: ObjectExpr) => void;
  analyzeIndex: (expr: IndexExpr) => void;
  analyzeAssignIndex: (expr: AssignIndexExpr) => void;

  // Recording
  define: (name: string, kind: Definition['kind'], loc?: Span) => Definition;
  reference: (name: string, loc?: Span) => void;
  diagnostic: (message: string, severity: Diagnostic['severity'], loc?: Span) => void;

  // State (accessible for inspection)
  definitions: Definition[];
  references: Reference[];
  diagnostics: Diagnostic[];
  tokens: SemanticToken[];

  // Record a semantic token
  token: (loc: Span, type: TokenType, modifiers?: TokenModifier[]) => void;

  // Builtins that shouldn't trigger "undefined" warnings
  builtins: Set<string>;
}

/**
 * Build an analyzer.
 *
 * We don't have an assumptions about the input analyzer `in$`, so it is typed
 * as `unknown`. We pull out each sub-expression into its own method so that
 * extensions can easily override them as needed.
 */
export function build$analyze(in$: unknown): void {
  const $ = in$ as AnalyzeOps;

  // State
  $.environment = new Environment();
  $.definitions = [];
  $.references = [];
  $.diagnostics = [];
  $.tokens = [];
  $.builtins = new Set(['$operators']);

  $.token = (loc, type, modifiers) => {
    $.tokens.push({ loc, type, modifiers });
  };

  $.define = (name, kind, loc) => {
    const def: Definition = { name, kind, loc };
    $.definitions.push(def);
    $.environment.define(name, def);
    return def;
  };

  $.reference = (name, loc) => {
    const definition = $.environment.resolve(name);
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
    $.environment = new Environment();
    $.definitions = [];
    $.references = [];
    $.diagnostics = [];
    $.tokens = [];

    // Walk the AST
    $.analyzeExpr(expr);

    return {
      definitions: $.definitions,
      references: $.references,
      diagnostics: $.diagnostics,
      tokens: $.tokens,
    };
  };

  // Walk expressions - extensions can override for new node types
  $.analyzeExpr = (expr) => {
    switch (expr.type) {
      case 'LiteralExpr':
        $.analyzeLiteral(expr);
        break;

      case 'IdentifierExpr': {
        $.analyzeIdentifier(expr);
        break;
      }

      case 'LetExpr': {
        $.analyzeLet(expr);
        break;
      }

      case 'LambdaExpr':
        $.analyzeLambda(expr);
        break;

      case 'AppExpr':
        $.analyzeApp(expr);
        break;

      case 'IfExpr':
        $.analyzeIf(expr);
        break;

      case 'ObjectExpr':
        $.analyzeObject(expr);
        break;

      case 'IndexExpr':
        $.analyzeIndex(expr);
        break;

      case 'AssignIndexExpr':
        $.analyzeAssignIndex(expr)
        break;

      default:
        // Unknown node type - extensions may have added it.
        // They should override analyzeExpr to handle it, but they may not.
        break;
    }
  };

  $.analyzeLiteral = (expr: LiteralExpr) => {
    // Record token for literal
    if (expr.loc) {
      const v = expr.value;
      if (typeof v === 'number') {
        $.token(expr.loc, 'number');
      } else if (typeof v === 'string') {
        $.token(expr.loc, 'string');
      } else if (typeof v === 'boolean' || v === null) {
        // Treat true/false/null as keywords.
        $.token(expr.loc, 'keyword');
      }
      else {
        // Allow overrides to have created other literal types,
        // but not created an analyze for them.
      }
    }
  };

  $.analyzeIdentifier = (expr: IdentifierExpr) => {
    $.reference(expr.name, expr.loc);

    // Record token - type depends on what it resolves to
    if (expr.loc) {
      const resolved = $.references[$.references.length - 1]?.definition;
      if (resolved?.kind === 'param') {
        $.token(expr.loc, 'parameter');
      } else {
        $.token(expr.loc, 'variable');
      }
    }
  };

  $.analyzeLet = (expr: LetExpr) => {
    // Define the name before analyzing the value and body; this allows the value
    // to refer to the name, for recursive functions. This also means that
    // (incorrectly) recursive values will not trigger undefined warnings, but cest la vie.
    $.define(expr.name.name, 'let', expr.name.loc ?? expr.loc);

    // Record token for binding name
    if (expr.name.loc) {
      $.token(expr.name.loc, 'variable', ['declaration']);
    }

    $.analyzeExpr(expr.value);
    $.analyzeExpr(expr.body);
  };

  $.analyzeLambda = (expr: LambdaExpr) => {
    $.environment.push();

    // Define parameters in the scope; add tokens for them too.
    expr.params.forEach((param, i) => {
      $.define(param.name, 'param', param.loc);

      // Record token for parameter
      if (param.loc) {
        $.token(param.loc, 'parameter', ['declaration']);
      }
    });

    // Analyze lambda body with the parameters in the environment.
    $.analyzeExpr(expr.body);

    $.environment.pop();
  };

  $.analyzeApp = (expr: AppExpr) => {
    $.analyzeExpr(expr.fn);
    for (const arg of expr.args) {
      $.analyzeExpr(arg);
    }
  };

  $.analyzeIf = (expr: IfExpr) => {
    $.analyzeExpr(expr.cond);
    $.analyzeExpr(expr.then);
    $.analyzeExpr(expr.else);
  };

  $.analyzeObject = (expr: ObjectExpr) => {
    for (const prop of expr.properties) {
      // Record token for property key
      if (prop.keyLoc) {
        $.token(prop.keyLoc, 'property');
      }
      $.analyzeExpr(prop.value);
    }
  };

  $.analyzeIndex = (expr: IndexExpr) => {
    $.analyzeExpr(expr.object);
    $.analyzeExpr(expr.key);
  };

  $.analyzeAssignIndex = (expr: AssignIndexExpr) => {
    $.analyzeExpr(expr.object);
    $.analyzeExpr(expr.key);
    $.analyzeExpr(expr.value);
  };
};
