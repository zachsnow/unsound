/**
 * Exosphere Extension
 *
 * This extension implements something like the meso/thermo/exo language layers, plus additional
 * type checking and inference functionality.
 */
/*

Programs are statement lists.
Statements are just expressions + ";"
Blocks are { ... } with statement lists inside.

*/
import { AssignIndexExpr, Expr, SpanExpr } from "../ast";
import { CoreCompileOps } from "../compile";
import { CoreInterpretOps } from "../interpret";
import { ir, IR } from "../ir";
import { CoreParseOps, Parser } from "../parse"
import { Extension } from "../types";
import { UnhandledCaseError } from "../util";

type EProgram = {
  type: "Program",
  body: EExpr;
}

type EExpr =
  | Expr
  | TypedLetExpr
  | AssignExpr
  | BlockExpr
  ;

interface AssignExpr extends SpanExpr {
  type: "AssignExpr"; target: ETarget; value: EExpr
}

interface BlockExpr extends SpanExpr { type: "SeqExpr", exprs: EExpr[] }

interface TypedLetExpr extends SpanExpr {
  type: "TypedLetExpr"; name: string; annotation: EExpr; value: EExpr; body: EExpr;
}

type ETarget =
  | { type: "AssignIdentifierTarget", name: string }
  | { type: "AssignIndexTarget", object: EExpr, index: EExpr }
  ;

interface ParseOps {
  program: () => Parser<EExpr>;
  expr: () => Parser<EExpr>;

  blockExpr: () => Parser<BlockExpr>;
  assignExpr: () => Parser<AssignExpr>;
  assignTarget: () => Parser<ETarget>;

  statements: () => Parser<EExpr[]>;
  letStatement: () => Parser<EExpr>;
}
type ExoParseOps = CoreParseOps & ParseOps;

interface CompileOps {
  compileProgram: (expr: EExpr) => IR;

  compileExpr: (expr: EExpr) => IR;
}
type ExoCompileOps = CoreCompileOps & CompileOps;

interface InterpretOps extends CoreInterpretOps { }

const build$parse = (in$: CoreParseOps): void => {
  const $ = in$ as unknown as ExoParseOps;

  $.program = () => (input: string, pos: number) => {
    const exprs = $.statements()(input, pos);

    if (!exprs.ok) {
      return exprs;
    }
    return {
      ok: exprs.ok,
      pos: exprs.pos,
      value: { type: "Program", body: { type: "SeqExpr", exprs: exprs.value } },
    };
  };

  $.expr = () => (input: string, pos: number) => {

    $.blockExpr = () => (input: string, pos: number) => {
      const exprs = $.between(
        $.token("{"),
        $.statements(),
        $.token("}"),
      )(input, pos);

      if (!exprs.ok) {
        return exprs;
      }

      return {
        ok: exprs.ok,
        pos: exprs.pos,
        value: { type: "SeqExpr", exprs: exprs.value },
      };
    };

    $.statements = () => {
      return $.sepBy($.statement(), $.token(";"));
    };

    $.statement = () => (input: string, pos: number) => {
      return $.alt(
        $.letStatement(),
        $.expr(),
      )(input, pos);
    };

    $.letStatement = () => (input: string, pos: number) => {
      const results = $.seq(
        $.letKeyword(),
        $.typedLetBinding(),
        $.letInitializer(),
        $.letBody(),
      )(input, pos);
      if (!results) {
        return results;
      }
      return {
        ok: true,
        pos: results.pos,
        value: {
          type: "TypedLetExpr",
          name: results.value[1].name,
          value: results.value[2],
          body: results.value[3],
        },
      };
    };

    const coreExpr = $.expr;
    $.expr = () => (input: string, pos: number) => {
      return $.alt(
        $.lazy(() => $.assignExpr()),
        $.lazy(() => $.blockExpr()),
        coreExpr(),
      )(input, pos);
    };

    $.assignExpr = () => (input: string, pos: number) => {

    };
  };

  const build$compile = (in$: CoreCompileOps): void => {
    const $ = in$ as ExoCompileOps;

    $.compileProgram = (program: EProgram): IR => {
      return $.compileExpr(program.body);
    };

    const coreCompileExpr = $.compileExpr;
    $.compileExpr = (expr: EExpr): IR => {
      switch (expr.type) {
        case "AssignExpr": {
          const target = expr.target;
          switch (target.type) {
            case "AssignIdentifierTarget": {
              return ir.$("assign", $.ir.var("$env"), $.ir.string(target.name), $.compileExpr(expr.value));
            }
            case "AssignIndexTarget": {
              const objectIR = $.compileExpr(target.object);
              const indexIR = $.compileExpr(target.index);
              const valueIR = $.compileExpr(expr.value);
              return ir.$("assignIndex", objectIR, indexIR, valueIR);
            }
            default:
              throw new UnhandledCaseError("compileExpr: assign target", target);
          }
        }
        case "SeqExpr": {
          const exprsIR = expr.exprs.map(e => $.compileExpr(e));
          return ir.seq(...exprsIR);
        }
        case "TypedLetExpr": {

        }
        default:
          return coreCompileExpr(expr);
      }
    }
  };

  const build$interpret = (in$: CoreInterpretOps): void => {
    const $ = in$ as InterpretOps;
  };

  export const exosphereExtension: Extension = {
    name: "Exosphere",
    version: "1.0.0",
    description: "An extension that provides an untyped JS-like language.",
    $parse: build$parse,
    $compile: build$compile,
    $interpret: build$interpret,
  }
