/**
 * Lazy Extension
 *
 * This extension adds lazy arguments to lambda functions in core-like languages.
 * A lazy argument is indicated by a tilde (~) before the parameter name
 * in the lambda definition. All functions are called with arguments wrapped in thunks,
 * and then lambdas force their eager arguments immediately. This allows callers to
 * be unaware of which parameters are lazy or eager.
 */
import { AnalyzeOps } from "../analyze";
import type { Expr, LambdaExpr, Name, SpanExpr } from "../ast";
import { CoreCompileOps } from "../compile";
import { ir, IR } from "../ir";
import { CoreParseOps, Parser, ParseResult } from "../parse";
import { Extension } from "../types";

/**
 * Note: this is not really correct; what we'd like is that all nested references of `Expr` in `LazyExpr`
 * are also `LazyExpr`s, but TypeScript doesn't support that kind of recursive type definition. In C++
 * we might use the Curiously Recurring Template Pattern (CRTP) to achieve this.
 *
 * We exclude LambdaExpr because we want to treat all lambdas as lazy (some just have only eager arguments).
 */
export type LazyExpr =
  | Exclude<Expr, { type: "LambdaExpr" }>
  | LazyLambdaExpr
  ;

interface LazyLambdaExpr extends SpanExpr {
  type: "LazyLambdaExpr";
  params: LazyParam[];
  body: LazyExpr;
}

interface LazyParam extends Name {
  /** Whether the parameter is lazy. */
  lazy: boolean;
}

interface LazyParserOps extends CoreParseOps {
  lazyLambda: () => (input: string, pos: number) => ParseResult<LazyLambdaExpr>;
  lazyLambdaParams: () => Parser<LazyParam[]>;
  lazyLambdaParam: () => Parser<LazyParam>;
}

interface LazyCompileOps extends CoreCompileOps {
  compileLazyLambda: (lambda: LazyLambdaExpr) => IR;
}

export const lazyExtension: Extension = {
  name: "lazy",
  description: "Adds lazy parameters to lambda expressions",
  version: "1.0.0",
  requires: ["core"],

  $parse: (in$: CoreParseOps) => {
    const $ = in$ as LazyParserOps;

    // Actually parse lazy lambdas.
    $.lazyLambda = () => (input, pos) => {
      const ws = $.ws()(input, pos);
      const start = ws.pos;

      const params = $.lazyLambdaParams()(input, pos);
      if (!params.ok) { return params; }

      const arrow = $.lambdaArrow()(input, params.pos);
      if (!arrow.ok) { return arrow; }

      const body = $.lambdaBody()(input, arrow.pos);
      if (!body.ok) { return body; }

      return {
        ok: true,
        value: {
          type: "LazyLambdaExpr",
          params: params.value,
          body: body.value as LazyExpr,
          loc: { start, end: body.pos },
        },
        pos: body.pos,
      };
    };

    // Always translate lambdas as lazy lambdas, so we never
    // produce plain LambdaExpr nodes.
    $.lambda = $.lazyLambda as any;

    $.lazyLambdaParam = () => (input, pos) => {
      // A lazy param starts with ~, e.g. (x, ~y) => ...
      const tilde = $.token("~")(input, pos);
      const lazy = tilde.ok;
      const startPos = lazy ? tilde.pos : pos;

      // Otherwise this is just a lambda parameter.
      const param = $.lambdaParam()(input, startPos);
      if (!param.ok) return param;

      return {
        ok: true,
        value: {
          ...param.value,
          lazy,
        } satisfies LazyParam,
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

    $.compileExpr = (expr) => {
      // Extend to support lazy lambdas.
      const e: LazyExpr = expr as LazyExpr;
      if (e.type === "LazyLambdaExpr") {
        return $.compileLazyLambda(e);
      }
      return originalCompileExpr.call($, expr);
    };

    // (x, ~y) => body
    //
    // Like a normal lambda, but because we expect calls to wrap *all*
    // arguments in thunks, we need to *unwrap* eager arguments immediately.
    // We emit $.force($env, "paramName") to look up the thunk and call it,
    // mutating the binding to the forced value.
    $.compileLazyLambda = (expr) => {
      // Force all non-lazy parameters immediately.
      const forces: IR[] = expr.params.map((param) => {
        if (!param.lazy) {
          return ir.$("force", ir.var("$env"), ir.lit(param.name));
        }
      }).filter(p => p !== undefined);

      return ir.$(
        "lambda",
        ir.var("$env"),
        ir.array(...expr.params.map((param) => ir.lit(param.name))),
        ir.arrow(["$env"], ir.seq(
          ...forces,
          $.compileExpr(expr.body as Expr)
        )),
      );
    };

    $.compileApp = (expr) => {
      // In order to support lazy arguments, we wrap the argument expressions in
      // thunks.
      const compiledArgs = expr.args.map((arg) =>
        ir.arrow([], $.compileExpr(arg))
      );

      return ir.$(
        "call",
        $.compileExpr(expr.fn),
        ir.array(...compiledArgs),
      );
    }
  },

  $analyze: (in$: AnalyzeOps) => {
    const $ = in$ as AnalyzeOps;

    const originalAnalyzeExpr = $.analyzeExpr;

    // Analyze expressions, treating lazy lambda just like a normal lambda.
    $.analyzeExpr = (expr) => {
      // Extend to support lazy lambdas.
      const e: LazyExpr = expr as LazyExpr;
      if (e.type === "LazyLambdaExpr") {
        // HACK: cast to normal LambdaExpr for analysis purposes;
        // analyzeLambda doesn't depend on `type: "LambdaExpr"` specifically.
        $.analyzeLambda(expr as LambdaExpr);
        return;
      }

      originalAnalyzeExpr(expr);
    };
  },

  $interpret: (in$: any) => {
    const $ = in$;

    // Force a thunked parameter: look up the thunk, call it, mutate the binding.
    $.force = ($env: any, name: string) => {
      const thunk = $env.lookup(name);
      const value = thunk();
      $env.mutate(name, value);
      return value;
    };
  },
};

export default lazyExtension;
