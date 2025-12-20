// trace.ts - Tracing extension for debugging
//   $interpret: logs every operation being evaluated

import { CoreInterpretOps } from "../interpret.ts";
import { Logger } from "../logger.ts";
import { prettyPrint } from "../pretty.ts";
import { Extension } from "../types.ts";

let depth = 0;
const indent = () => "  ".repeat(depth);

const logger = new Logger("trace");

function log(op: string, ...args: unknown[]) {
  const formatted = args.map((a) => prettyPrint(a)).join(", ");
  logger.debug(`${indent()}${op}(${formatted})`);
}

function logReturn(op: string, result: unknown) {
  logger.debug(`${indent()}${op}:${prettyPrint(result)}`);
}

export const traceExtension: Extension = {
  name: "trace",
  description:
    "Tracing extension that logs file I/O and interpreter operations",
  version: "1.0.0",

  $interpret: ($: CoreInterpretOps) => {
    const base = {
      number: $.number,
      string: $.string,
      boolean: $.boolean,
      lookup: $.lookup,
      let: $.let,
      lambda: $.lambda,
      call: $.call,
      if: $.if,
      object: $.object,
      index: $.index,
      assignIndex: $.assignIndex,
    };

    $.number = (n) => {
      log("number", n);
      const r = base.number(n);
      logReturn("number", r);
      return r;
    };

    $.string = (s) => {
      log("string", s);
      const r = base.string(s);
      logReturn("string", r);
      return r;
    };

    $.boolean = (b) => {
      log("boolean", b);
      const r = base.boolean(b);
      logReturn("boolean", r);
      return r;
    };

    $.lookup = ($env, name) => {
      log("lookup", name);
      const r = base.lookup($env, name);
      logReturn("lookup", r);
      return r;
    };

    $.let = ($env, name, valueFn, bodyFn) => {
      log("let", name);
      depth++;
      const r = base.let($env, name, valueFn, bodyFn);
      depth--;
      logReturn("let", r);
      return r;
    };

    $.lambda = ($env, params, bodyFn) => {
      log("lambda", params);
      const r = base.lambda($env, params, bodyFn);
      logReturn("lambda", r);
      return r;
    };

    $.call = (fn, args) => {
      log("call", fn, args);
      depth++;
      const r = base.call(fn, args);
      depth--;
      logReturn("call", r);
      return r;
    };

    $.if = (cond, thenFn, elseFn, $env) => {
      log("if", cond);
      depth++;
      const r = base.if(cond, thenFn, elseFn, $env);
      depth--;
      logReturn("if", r);
      return r;
    };

    $.object = (props) => {
      log("object", props);
      const r = base.object(props);
      logReturn("object", r);
      return r;
    };

    $.index = (obj, key) => {
      log("index", obj, key);
      const r = base.index(obj, key);
      logReturn("index", r);
      return r;
    };

    $.assignIndex = (obj, key, value) => {
      log("assignIndex", key, value);
      const r = base.assignIndex(obj, key, value);
      logReturn("assignIndex", r);
      return r;
    };
  },
};

export default traceExtension;
