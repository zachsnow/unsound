import { AnalyzeOps } from "../analyze";
import type { Expr, LambdaExpr, SpanExpr } from "../ast";
import { $compile, CoreCompileOps } from "../compile";
import { CoreInterpretOps } from "../interpret";
import { ir, IR } from "../ir";
import { CoreParseOps, Parser, ParseResult } from "../parse";
import { Extension } from "../types";

/**
 * Note: this is not really correct; what we'd like is that all nested references of `Expr` in `LazyExpr`
 * are also `LazyExpr`s, but TypeScript doesn't support that kind of recursive type definition. In C++
 * we might use the Curiously Recurring Template Pattern (CRTP) to achieve this.
 */
export type LazyExpr =
  | Expr
  | LazyLambdaExpr
  ;

interface LazyLambdaExpr extends SpanExpr {
  type: "LazyLambdaExpr";
  params: Param[];
  body: LazyExpr;
}

interface Param extends SpanExpr {
  name: string;

  /** Whether the parameter is lazy. */
  lazy: boolean;
}

interface LazyParserOps extends CoreParseOps {
  lazyLambda: () => (input: string, pos: number) => ParseResult<LazyLambdaExpr>;
  lazyLambdaParams: () => Parser<Param[]>;
  lazyLambdaParam: () => Parser<Param>;
}

interface LazyCompileOps extends CoreCompileOps {
  compileLazyLambda: (lambda: LazyLambdaExpr) => IR;
}

interface LazyInterpretOps extends CoreInterpretOps {
  lazyLambda: (env: any, params: string[], body: any) => any;
}

export const lazyExtension: Extension = {
  name: "lazy",
  description: "Adds lazy parameters to lambda expressions",
  version: "1.0.0",

  $parse: (in$: CoreParseOps) => {
    const $ = in$ as LazyParserOps;

    const originalLambda = $.lambda;
    $.lambda = () =>
      $.alt(
        $.lazy(() => originalLambda()),
        $.lazy(() => $.lazyLambda() as Parser<LambdaExpr>),
      );

    $.lazyLambda = () => (input, pos) => {
      const ws = $.ws()(input, pos);
      const start = ws.pos;

      const params = $.lazyLambdaParams()(input, pos);
      if (!params.ok) return params as ParseResult<LazyLambdaExpr>;

      const arrow = $.lambdaArrow()(input, params.pos);
      if (!arrow.ok) return arrow as ParseResult<LazyLambdaExpr>;

      const body = $.lambdaBody()(input, arrow.pos);
      if (!body.ok) return body as ParseResult<LazyLambdaExpr>;

      return {
        ok: true,
        value: {
          type: "LazyLambdaExpr",
          params: params.value,
          body: body.value,
          loc: { start, end: body.pos },
        } satisfies LazyLambdaExpr,
        pos: body.pos,
      };
    };

    $.lazyLambdaParam = () => (input, pos) => {
      // A lazy param starts with ~, e.g. (x, ~y) => ...
      const tilde = $.token("~")(input, pos);
      const lazy = tilde.ok;
      const startPos = lazy ? tilde.pos : pos;

      // Otherwise this is just a lambda parameter.
      const param = $.lambdaParam()(input, startPos);
      if (!param.ok) return param as ParseResult<Param>;

      return {
        ok: true,
        value: {
          ...param.value,
          lazy,
        } satisfies Param,
        pos: param.pos,
      };
    };

    $.lazyLambdaParams = () => $.between(
      $.token("("),
      $.sepBy($.lazy(() => $.lazyLambdaParam()), $.token(",")),
      $.token(")")
    );
  },

  $compile: (in$: CoreCompileOps) => {
    const $ = in$ as LazyCompileOps;

    const originalCompileExpr = $.compileExpr;

    $.compileExpr = (expr: LazyExpr) => {
      if (expr.type === "LazyLambdaExpr") {
        return $.compileLazyLambda(expr);
      }
      return originalCompileExpr.call($, expr);
    };

    // (x, ~y) => body
    // Just like lambda; the parameter laziness is handled at call time.
    $.compileLazyLambda = (expr) => {
      return ir.$(
        "lazyLambda",
        ir.var("$env"),
        ir.array(...expr.params.map((param) => ir.lit(param.name))),
        ir.arrow(["$env"], $.compileExpr(expr.body as Expr))
      );
    };
  },

  $analyze: (in$: AnalyzeOps) => {
    const $ = in$ as AnalyzeOps;

    const originalAnalyzeExpr = $.analyzeExpr;

    // Analyze expressions, treating lazy lambda just like a normal lambda.
    $.analyzeExpr = (expr: LazyExpr) => {
      if (expr.type === "LazyLambdaExpr") {
        // HACK: cast to normal LambdaExpr for analysis purposes;
        // analyzeLambda doesn't depend on type: "LambdaExpr" specifically.
        $.analyzeLambda(expr as any as LambdaExpr);
        return;
      }

      originalAnalyzeExpr(expr as LambdaExpr);
    };
  },

  $interpret: (in$: CoreInterpretOps) => {
    const $ = in$ as LazyInterpretOps;
  },

};