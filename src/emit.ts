/**
 * Core emitter.
 */
import { type IR } from "./ir.ts";
import { EmitOps } from "./types.ts";
import { UnhandledCaseError } from "./util.ts";

export type Env = Record<string, unknown>;
export type Closure = (env: Env) => unknown;
export type ProgramClosure = (env: Env) => ($: unknown) => Promise<unknown>;

export interface CoreEmitOps extends EmitOps<IR> {
  string: (ir: IR) => string;
  program: (ir: IR) => string;
  programClosure: (ir: IR) => ProgramClosure;
}

// === Emit to String ===

export function emitString(node: IR): string {
  switch (node.tag) {
    case 'assign':
      return `${node.name} = ${emitString(node.value)}`;

    case 'literal':
      if (node.value === undefined) {
        return "undefined";
      }
      return JSON.stringify(node.value);

    case 'var':
      return node.name;

    case 'call': {
      const fn = emitString(node.fn);
      const args = node.args.map(a =>
        a.tag === 'spread' ? `...${emitString(a.value)}` : emitString(a)
      ).join(', ');
      return `${fn}(${args})`;
    }

    case 'member':
      return `${emitString(node.obj)}.${node.field}`;

    case 'index':
      return `${emitString(node.obj)}[${emitString(node.key)}]`;

    case 'arrow': {
      const params = node.params.join(', ');
      const body = emitString(node.body);
      return node.params.length === 1
        ? `(${params}) => ${body}`
        : `(${params}) => ${body}`;
    }

    case 'function': {
      const params = node.params.join(', ');
      const body = emitString(node.body);
      return `function(${params}) { return ${body}; }`;
    }

    case 'object': {
      const props = node.properties.map(p =>
        `[${JSON.stringify(p.key)}]: ${emitString(p.value)}`
      ).join(', ');
      return `{ ${props} }`;
    }

    case 'array': {
      const elems = node.elements.map(e =>
        e.tag === 'spread' ? `...${emitString(e.value)}` : emitString(e)
      ).join(', ');
      return `[${elems}]`;
    }

    case 'spread':
      return `...${emitString(node.value)}`;

    case 'ternary':
      return `(${emitString(node.cond)} ? ${emitString(node.then)} : ${emitString(node.else)})`;

    case 'seq':
      const parts = node.elements.map(emitString).join(', ');
      return `(${parts})`;

    default:
      throw new UnhandledCaseError("IR tag", node);
  }
}

// === Emit to Closure ===

export function emitClosure(node: IR): Closure {
  switch (node.tag) {
    case 'assign': {
      const valueClosure = emitClosure(node.value);
      return (env) => {
        return (env[node.name] = valueClosure(env));
      };
    }

    case 'literal':
      return (_env) => node.value;

    case 'var':
      return (env) => env[node.name];

    case 'call': {
      const fnClosure = emitClosure(node.fn);
      const argClosures = node.args.map(a => {
        if (a.tag === 'spread') {
          const inner = emitClosure(a.value);
          return { spread: true, fn: inner };
        }
        return { spread: false, fn: emitClosure(a) };
      });

      return (env) => {
        const fn = fnClosure(env) as Function;
        const args: unknown[] = [];
        for (const arg of argClosures) {
          if (arg.spread) {
            const spreadVal = arg.fn(env);
            if (Array.isArray(spreadVal)) {
              args.push(...spreadVal);
            }
          } else {
            args.push(arg.fn(env));
          }
        }
        return fn(...args);
      };
    }

    case 'member': {
      const objClosure = emitClosure(node.obj);
      return (env) => (objClosure(env) as any)[node.field];
    }

    case 'index': {
      const objClosure = emitClosure(node.obj);
      const keyClosure = emitClosure(node.key);
      return (env) => (objClosure(env) as any)[keyClosure(env) as any];
    }

    case 'arrow': {
      const bodyClosure = emitClosure(node.body);
      return (env) => (...args: unknown[]) => {
        const innerEnv = { ...env };
        node.params.forEach((p, i) => { innerEnv[p] = args[i]; });
        return bodyClosure(innerEnv);
      };
    }

    case 'function': {
      const bodyClosure = emitClosure(node.body);
      return (env) => function (this: unknown, ...args: unknown[]) {
        const innerEnv: Env = { ...env, this: this };
        node.params.forEach((p, i) => { innerEnv[p] = args[i]; });
        return bodyClosure(innerEnv);
      };
    }

    case 'object': {
      const propClosures = node.properties.map(p => ({
        key: p.key,
        valueClosure: emitClosure(p.value)
      }));
      return (env) => {
        const obj: Record<string, unknown> = {};
        for (const { key, valueClosure } of propClosures) {
          obj[key] = valueClosure(env);
        }
        return obj;
      };
    }

    case 'array': {
      const elemClosures = node.elements.map(e => {
        if (e.tag === 'spread') {
          const inner = emitClosure(e.value);
          return { spread: true, fn: inner };
        }
        return { spread: false, fn: emitClosure(e) };
      });

      return (env) => {
        const arr: unknown[] = [];
        for (const elem of elemClosures) {
          if (elem.spread) {
            const spreadVal = elem.fn(env);
            if (Array.isArray(spreadVal)) {
              arr.push(...spreadVal);
            }
          } else {
            arr.push(elem.fn(env));
          }
        }
        return arr;
      };
    }

    case 'spread':
      // Spread is handled in call/array contexts
      throw new Error('spread must be used in call or array context');

    case 'ternary': {
      const condClosure = emitClosure(node.cond);
      const thenClosure = emitClosure(node.then);
      const elseClosure = emitClosure(node.else);
      return (env) => condClosure(env) ? thenClosure(env) : elseClosure(env);
    }

    case 'seq': {
      const closures = node.elements.map(emitClosure);
      return (env) => {
        let last;
        for (const closure of closures) {
          last = closure(env);
        }
        return last;
      };
    }

    default:
      throw new UnhandledCaseError("IR tag", node);
  }
}

// === Program wrapper ===

export function emitProgramString(body: IR): string {
  return `export default async ($) => {
  let $env = $.env();
  return ${emitString(body)};
};`;
}

export function emitProgramClosure(body: IR): (env: Env) => ($: unknown) => Promise<unknown> {
  const bodyClosure = emitClosure(body);
  return (env) => async ($: unknown) => {
    // Create initial $env from interpreter
    const $env = ($ as any).env();
    return bodyClosure({ ...env, $, $env });
  };
}

export function build$emit(in$: EmitOps): void {
  const $ = in$ as CoreEmitOps;

  $.string = emitString;
  $.program = emitProgramString;
  $.programClosure = emitProgramClosure;
};
