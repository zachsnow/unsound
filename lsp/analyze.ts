// AST-based analyzer for LSP support
// Walks the AST to collect symbols, references, and diagnostics

import type * as AST from '../ast.ts';
import type { SourceRange } from '../ast.ts';

// Symbol definition
export interface Definition {
  name: string;
  loc: SourceRange;
  kind: 'variable' | 'parameter' | 'import';
}

// Symbol reference
export interface Reference {
  name: string;
  loc: SourceRange;
  definition: Definition | null; // null if unresolved
}

// Diagnostic (error/warning)
export interface Diagnostic {
  message: string;
  loc: SourceRange;
  severity: 'error' | 'warning' | 'info';
}

// Analysis result
export interface AnalysisResult {
  definitions: Definition[];
  references: Reference[];
  diagnostics: Diagnostic[];
}

// Scope for symbol resolution
type Scope = Map<string, Definition>;

class Analyzer {
  private definitions: Definition[] = [];
  private references: Reference[] = [];
  private diagnostics: Diagnostic[] = [];
  private scopes: Scope[] = [new Map()];

  analyze(program: AST.Program): AnalysisResult {
    // Add imports to top-level scope
    for (const imp of program.imports) {
      this.define(imp.name, imp.loc, 'import');
    }

    // Analyze body
    this.analyzeStmtSeq(program.body);

    return {
      definitions: this.definitions,
      references: this.references,
      diagnostics: this.diagnostics,
    };
  }

  private pushScope(): void {
    this.scopes.push(new Map());
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private define(name: string, loc: SourceRange | undefined, kind: Definition['kind']): Definition {
    const def: Definition = {
      name,
      loc: loc ?? { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } },
      kind,
    };
    this.definitions.push(def);
    // Add to current scope
    const scope = this.scopes[this.scopes.length - 1];
    scope.set(name, def);
    return def;
  }

  private resolve(name: string): Definition | null {
    // Walk scopes from innermost to outermost
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const def = this.scopes[i].get(name);
      if (def) return def;
    }
    return null;
  }

  private reference(name: string, loc: SourceRange | undefined): void {
    const def = this.resolve(name);
    this.references.push({
      name,
      loc: loc ?? { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } },
      definition: def,
    });
    if (!def && !this.isBuiltin(name)) {
      this.diagnostics.push({
        message: `Cannot find name '${name}'`,
        loc: loc ?? { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } },
        severity: 'error',
      });
    }
  }

  private isBuiltin(name: string): boolean {
    // Built-in globals accessible via globalThis
    const builtins = new Set([
      'Object', 'Array', 'String', 'Number', 'Boolean', 'Math',
      'console', 'JSON', 'Date', 'RegExp', 'Error', 'Promise',
      'undefined', 'null', 'NaN', 'Infinity',
    ]);
    return builtins.has(name);
  }

  private analyzeStmtSeq(seq: AST.StmtSeq): void {
    for (const stmt of seq.statements) {
      this.analyzeStatement(stmt);
    }
    if (seq.expr) {
      this.analyzeExpr(seq.expr);
    }
  }

  private analyzeStatement(stmt: AST.Statement): void {
    switch (stmt.type) {
      case 'LetStatement': {
        // Define the symbol first so recursive functions can reference themselves
        this.define(stmt.name, (stmt as any).nameLoc ?? stmt.loc, 'variable');
        // Then analyze the value
        this.analyzeExpr(stmt.value);
        break;
      }
      case 'ReturnStatement':
        this.analyzeExpr(stmt.expr);
        break;
      case 'ExprStatement':
        this.analyzeExpr(stmt.expr);
        break;
    }
  }

  private analyzeExpr(expr: AST.Expression): void {
    switch (expr.type) {
      case 'LambdaExpression':
        this.pushScope();
        // Add parameters to scope
        for (const param of expr.params) {
          this.define(param.name, param.loc, 'parameter');
        }
        // Analyze body
        if (expr.body.type === 'Block') {
          this.analyzeStmtSeq(expr.body.body);
        } else {
          this.analyzeExpr(expr.body);
        }
        this.popScope();
        break;

      case 'IfExpression':
        this.analyzeExpr(expr.condition);
        this.analyzeExpr(expr.then);
        if (expr.else) {
          this.analyzeExpr(expr.else);
        }
        break;

      case 'DoExpression':
        this.analyzeStmtSeq(expr.block.body);
        break;

      case 'AssignExpression':
        if (expr.target.type === 'VarTarget') {
          // Variable assignment - reference the variable
          this.reference(expr.target.name, expr.target.loc);
        } else {
          // Member assignment
          this.analyzeExpr(expr.target.object);
          this.analyzeExpr(expr.target.key);
        }
        this.analyzeExpr(expr.value);
        break;

      case 'BinaryOpExpression':
        this.analyzeExpr(expr.left);
        this.analyzeExpr(expr.right);
        break;

      case 'UnaryOpExpression':
        this.analyzeExpr(expr.operand);
        break;

      case 'CallExpression':
        this.analyzeExpr(expr.callee);
        for (const arg of expr.args) {
          this.analyzeExpr(arg.value);
        }
        break;

      case 'MemberExpression':
        this.analyzeExpr(expr.object);
        if (expr.computed && expr.propertyExpr) {
          this.analyzeExpr(expr.propertyExpr);
        }
        break;

      case 'ObjectLiteral':
        for (const prop of expr.properties) {
          this.analyzeExpr(prop.value);
        }
        break;

      case 'ArrayLiteral':
        for (const elem of expr.elements) {
          this.analyzeExpr(elem);
        }
        break;

      case 'IdentifierExpression':
        this.reference(expr.name, expr.loc);
        break;

      // Literals don't need analysis
      case 'NumberLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
      case 'NullLiteral':
      case 'UndefinedLiteral':
      case 'ThisExpression':
        break;
    }
  }
}

export function analyze(program: AST.Program): AnalysisResult {
  const analyzer = new Analyzer();
  return analyzer.analyze(program);
}

// Find definition at a position
export function findDefinitionAt(result: AnalysisResult, line: number, column: number): Definition | null {
  // Check if position is on a reference
  for (const ref of result.references) {
    if (isInRange(ref.loc, line, column)) {
      return ref.definition;
    }
  }
  // Check if position is on a definition
  for (const def of result.definitions) {
    if (isInRange(def.loc, line, column)) {
      return def;
    }
  }
  return null;
}

// Find all references to a symbol
export function findReferences(result: AnalysisResult, name: string): Reference[] {
  return result.references.filter(ref => ref.name === name);
}

// Check if position is within a location
function isInRange(loc: SourceRange, line: number, column: number): boolean {
  if (line < loc.start.line || line > loc.end.line) return false;
  if (line === loc.start.line && column < loc.start.column) return false;
  if (line === loc.end.line && column > loc.end.column) return false;
  return true;
}
