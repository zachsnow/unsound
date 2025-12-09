// Generic interpreter infrastructure
// Provides types and base implementation that can be extended
//
// Key design: env is an opaque lexically-scoped value passed explicitly.
// The compiler threads env through; interpreters decide what env contains.

// Environment interface - what operations can be done on env
// Different interpreters can provide different implementations
export interface Env {
  lookup(name: string): unknown;
  extend(bindings: Record<string, unknown>): Env;  // Create child env
  bind(name: string, value: unknown): void;        // Mutate current frame (for letrec)
  mutate(name: string, value: unknown): void;      // Mutate existing binding (for assignment)
  markConst(name: string): void;                   // Mark binding as const (for const.us)
  isConst(name: string): boolean;                  // Check if binding is const
}

// Interpreter operations - what $ provides at runtime
// Operations that need $env take it as first parameter
export interface InterpretOps {
  // Environment factory
  env: () => Env;

  // Literals (no $env needed)
  number: (n: number) => unknown;
  string: (s: string) => unknown;
  boolean: (b: boolean) => unknown;

  // Bindings ($env passed explicitly)
  lookup: ($env: Env, name: string) => unknown;
  let: ($env: Env, name: string, valueFn: ($env: Env) => unknown, bodyFn: ($env: Env) => unknown) => unknown;
  // assign is provided by meso extension, not base

  // Functions ($env passed explicitly for closure capture)
  lambda: ($env: Env, params: string[], bodyFn: ($env: Env) => unknown) => unknown;
  call: (fn: unknown, args: unknown[]) => unknown;

  // Control ($env passed to thunks)
  if: (cond: unknown, thenFn: ($env: Env) => unknown, elseFn: ($env: Env) => unknown, $env: Env) => unknown;

  // Objects (no $env needed)
  object: (properties: Record<string, unknown>) => unknown;
  index: (obj: unknown, key: unknown) => unknown;
  setIndex: (obj: unknown, key: unknown, value: unknown) => unknown;

  // Extensions can add more operations
  [key: string]: unknown;
}

// Create a prototype-chain based environment
// Uses Object.create for efficient inheritance
// Tracks const bindings in a separate set that inherits via prototype
export function createEnv(initial: Record<string, unknown> = {}): Env {
  const frame = { ...initial };
  const consts: Record<string, boolean> = {};

  return createEnvFromFrame(frame, consts);
}

// Helper to create env from existing frame (for extend)
function createEnvFromFrame(frame: Record<string, unknown>, consts: Record<string, boolean>): Env {
  return {
    lookup(name: string): unknown {
      return frame[name];
    },
    extend(bindings: Record<string, unknown>): Env {
      // Child inherits from this frame and consts via prototype
      const childFrame = Object.create(frame);
      Object.assign(childFrame, bindings);
      const childConsts = Object.create(consts);
      return createEnvFromFrame(childFrame, childConsts);
    },
    bind(name: string, value: unknown): void {
      frame[name] = value;
    },
    mutate(name: string, value: unknown): void {
      // Walk prototype chain to find and update existing binding
      let obj: Record<string, unknown> | null = frame;
      while (obj !== null) {
        if (Object.hasOwn(obj, name)) {
          obj[name] = value;
          return;
        }
        obj = Object.getPrototypeOf(obj);
      }
      throw new Error(`Cannot assign to undefined variable: ${name}`);
    },
    markConst(name: string): void {
      consts[name] = true;
    },
    isConst(name: string): boolean {
      return consts[name] === true;
    },
  };
}

// Primitive operator methods
const numberOps = (n: number): Record<string, unknown> => ({
  'op+': (other: unknown) => n + (other as number),
  'op-': (other: unknown) => n - (other as number),
  'op*': (other: unknown) => n * (other as number),
  'op/': (other: unknown) => n / (other as number),
  'op%': (other: unknown) => n % (other as number),
  'op<': (other: unknown) => n < (other as number),
  'op>': (other: unknown) => n > (other as number),
  'op<=': (other: unknown) => n <= (other as number),
  'op>=': (other: unknown) => n >= (other as number),
  'op==': (other: unknown) => n === other,
  'op!=': (other: unknown) => n !== other,
  'opNeg': () => -n,
});

const stringOps = (s: string): Record<string, unknown> => ({
  'op+': (other: unknown) => s + (other as string),
  'op==': (other: unknown) => s === other,
  'op!=': (other: unknown) => s !== other,
  'op<': (other: unknown) => s < (other as string),
  'op>': (other: unknown) => s > (other as string),
  'op<=': (other: unknown) => s <= (other as string),
  'op>=': (other: unknown) => s >= (other as string),
});

const booleanOps = (b: boolean): Record<string, unknown> => ({
  'op!': () => !b,
  'op==': (other: unknown) => b === other,
  'op!=': (other: unknown) => b !== other,
  'op&&': (other: unknown) => b && (other as boolean),
  'op||': (other: unknown) => b || (other as boolean),
});

// Access field on primitive: check ops first, then proxy to underlying with binding
function primitiveMember(obj: unknown, ops: Record<string, unknown>, field: string): unknown {
  if (field in ops) return ops[field];
  const value = (obj as any)[field];
  if (typeof value === 'function') return value.bind(obj);
  return value;
}

// Base interpreter builder - mutation style
// Extensions mutate $ to override methods
export function build$interpret($: InterpretOps, globals: Record<string, unknown> = {}): void {
  // Environment factory - creates initial env with globals
  $.env = () => createEnv(globals);

  $.number = (n) => n;
  $.string = (s) => s;
  $.boolean = (b) => b;
  $.null = () => null;

  $.lookup = ($env, name) => $env.lookup(name);

  $.let = ($env, name, valueFn, bodyFn) => {
    // Create child $env with name pre-bound to undefined (letrec semantics)
    const child = $env.extend({ [name]: undefined });
    // Evaluate value in child so recursive refs work
    const value = valueFn(child);
    // Update the binding
    child.bind(name, value);
    // Evaluate body in child
    return bodyFn(child);
  };

  // $.assign is provided by meso extension, not base

  $.lambda = ($env, params, bodyFn) => {
    // $env is captured via JS closure - lexical scoping!
    return (...args: unknown[]) => {
      const bindings: Record<string, unknown> = {};
      params.forEach((p, i) => { bindings[p] = args[i]; });
      // Create child of captured $env with param bindings
      const child = $env.extend(bindings);
      return bodyFn(child);
    };
  };

  $.call = (fn, args) => (fn as Function)(...args);

  // Strict equality - works on any values including null/undefined
  $.strictEq = (a, b) => a === b;
  $.strictNeq = (a, b) => a !== b;

  $.if = (cond, thenFn, elseFn, $env) => cond ? thenFn($env) : elseFn($env);

  $.object = (o) => o;

  $.array = (arr: any[]) => arr;

  $.index = (obj, key) => {
    const k = key as string;
    if (typeof obj === 'number') {
      return primitiveMember(obj, numberOps(obj), k);
    }
    if (typeof obj === 'string') {
      return primitiveMember(obj, stringOps(obj), k);
    }
    if (typeof obj === 'boolean') {
      return primitiveMember(obj, booleanOps(obj), k);
    }
    // Objects and arrays: bind methods to preserve 'this'
    const value = (obj as Record<string, unknown>)[k];
    if (typeof value === 'function') {
      return (value as Function).bind(obj);
    }
    return value;
  };

  $.setIndex = (obj, key, value) => {
    (obj as Record<string, unknown>)[key as string] = value;
    return value;
  };
}

// $operators object - provides operator functions for use in Unsound code
export const $operators: Record<string, (...args: unknown[]) => unknown> = {
  'op===': (a, b) => a === b,
  'op!==': (a, b) => a !== b,
  'op==': (a, b) => a == b,
  'op!=': (a, b) => a != b,
  'op<': (a, b) => (a as number) < (b as number),
  'op>': (a, b) => (a as number) > (b as number),
  'op<=': (a, b) => (a as number) <= (b as number),
  'op>=': (a, b) => (a as number) >= (b as number),
  'op+': (a, b) => (a as number) + (b as number),
  'op-': (a, b) => (a as number) - (b as number),
  'op*': (a, b) => (a as number) * (b as number),
  'op/': (a, b) => (a as number) / (b as number),
  'op%': (a, b) => (a as number) % (b as number),
  'op&&': (a, b) => a && b,
  'op||': (a, b) => a || b,
  'op!': (a) => !a,
  'opNeg': (a) => -(a as number),
};

// Default global environment
export const defaultEnv: Record<string, unknown> = {
  $operators,
};

// Convenience: create interpreter with default globals
export function createInterpret(globals: Record<string, unknown> = {}): InterpretOps {
  const $ = {} as InterpretOps;
  build$interpret($, { ...defaultEnv, ...globals });
  return $;
}
