// trace.ts - Tracing extension for debugging
// Wraps all phases to log what's happening:
//   $pre: logs file reads with timing
//   $post: logs file writes with timing
//   $interpret: logs every operation being evaluated

import type { Extension } from '../extension.ts';
import type { PreOps } from '../pre.ts';
import type { PostOps } from '../post.ts';
import type { InterpretOps, Env } from '../interpret.ts';
import { prettyPrint } from '../pretty.ts';

// Colors for terminal output
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string): string => `\x1b[36m${s}\x1b[0m`;

let depth = 0;
const indent = () => '  '.repeat(depth);

function log(op: string, ...args: unknown[]) {
  const formatted = args.map(a => prettyPrint(a)).join(', ');
  console.log(`${indent()}${op}(${formatted})`);
}

function logReturn(op: string, result: unknown) {
  console.log(`${indent()}=> ${prettyPrint(result)}`);
}

export const traceExtension: Extension = {
  name: 'trace',
  description: 'Tracing extension that logs file I/O and interpreter operations',
  version: '1.0.0',

  $pre: ($: PreOps) => {
    const baseRead = $.read;
    $.read = (path) => {
      const start = performance.now();
      console.log(cyan(`[pre] reading ${path}...`));
      const content = baseRead(path);
      const elapsed = (performance.now() - start).toFixed(2);
      console.log(dim(`[pre] read ${path} (${content.length} bytes, ${elapsed}ms)`));
      return content;
    };
  },

  $post: ($: PostOps) => {
    const baseWrite = $.write;
    $.write = (path, content) => {
      const start = performance.now();
      console.log(cyan(`[post] writing ${path}...`));
      baseWrite(path, content);
      const elapsed = (performance.now() - start).toFixed(2);
      console.log(dim(`[post] wrote ${path} (${content.length} bytes, ${elapsed}ms)`));
    };
  },

  $interpret: ($: InterpretOps) => {
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
      setIndex: $.setIndex,
    };

    $.number = (n) => {
      log('number', n);
      const r = base.number(n);
      logReturn('number', r);
      return r;
    };

    $.string = (s) => {
      log('string', s);
      const r = base.string(s);
      logReturn('string', r);
      return r;
    };

    $.boolean = (b) => {
      log('boolean', b);
      const r = base.boolean(b);
      logReturn('boolean', r);
      return r;
    };

    $.lookup = ($env, name) => {
      log('lookup', name);
      const r = base.lookup($env, name);
      logReturn('lookup', r);
      return r;
    };

    $.let = ($env, name, valueFn, bodyFn) => {
      log('let', name);
      depth++;
      const r = base.let($env, name, valueFn, bodyFn);
      depth--;
      logReturn('let', r);
      return r;
    };

    $.lambda = ($env, params, bodyFn) => {
      log('lambda', params);
      const r = base.lambda($env, params, bodyFn);
      logReturn('lambda', r);
      return r;
    };

    $.call = (fn, args) => {
      log('call', fn, args);
      depth++;
      const r = base.call(fn, args);
      depth--;
      logReturn('call', r);
      return r;
    };

    $.if = (cond, thenFn, elseFn, $env) => {
      log('if', cond);
      depth++;
      const r = base.if(cond, thenFn, elseFn, $env);
      depth--;
      logReturn('if', r);
      return r;
    };

    $.object = (props) => {
      log('object', props);
      const r = base.object(props);
      logReturn('object', r);
      return r;
    };

    $.index = (obj, key) => {
      log('index', obj, key);
      const r = base.index(obj, key);
      logReturn('index', r);
      return r;
    };

    $.setIndex = (obj, key, value) => {
      log('setIndex', key, value);
      const r = base.setIndex(obj, key, value);
      logReturn('setIndex', r);
      return r;
    };
  },
};

export default traceExtension;
