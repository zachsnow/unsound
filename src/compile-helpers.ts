import { Expr } from "./ast";
import { $compile } from "./compile";
import { build$emit, } from "./emit";
import { IR } from "./ir";
import { EmitOps } from "./types";
import { fix } from "./util";

const $emit: EmitOps = fix(build$emit);

// Convenience functions
export function compile(expr: Expr): IR {
  return $compile.compileProgram(expr);
}

export function compileToString(expr: Expr): string {
  return $emit.program(compile(expr));
}

export function compileToClosure(expr: Expr): ($: unknown) => Promise<unknown> {
  return $emit.programClosure(compile(expr))({}) as ($: unknown) => Promise<unknown>;
}
