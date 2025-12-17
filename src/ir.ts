/**
 * IR
 *
 * Represents the core format for communication between the compiler and emitter.
 */

/**
 * The type of IR expressions.
 */
export type IR =
  | { tag: 'literal'; value: number | string | boolean | null | undefined }
  | { tag: 'var'; name: string }
  | { tag: 'assign'; name: string; value: IR }
  | { tag: 'call'; fn: IR; args: IR[] }
  | { tag: 'member'; obj: IR; field: string }
  | { tag: 'index'; obj: IR; key: IR }
  | { tag: 'arrow'; params: string[]; body: IR }
  | { tag: 'function'; params: string[]; body: IR }
  | { tag: 'object'; properties: { key: string; value: IR }[] }
  | { tag: 'array'; elements: IR[] }
  | { tag: 'spread'; value: IR }
  | { tag: 'ternary'; cond: IR; then: IR; else: IR }
  | { tag: 'seq'; elements: IR[] };

/**
 * IR constructors and helpers.
 */
export const ir = {
  lit: (value: number | string | boolean | null | undefined): IR =>
    ({ tag: 'literal', value }),

  // Convenience aliases for Unsound extensions
  string: (s: string): IR => ({ tag: 'literal', value: s }),
  number: (n: number): IR => ({ tag: 'literal', value: n }),

  var: (name: string): IR =>
    ({ tag: 'var', name }),

  assign: (name: string, value: IR): IR => ({ tag: 'assign', name, value }),

  // Variadic call - works from Unsound without needing JS arrays
  call: (fn: IR, ...args: IR[]): IR =>
    ({ tag: 'call', fn, args }),

  member: (obj: IR, field: string): IR =>
    ({ tag: 'member', obj, field }),

  index: (obj: IR, key: IR): IR =>
    ({ tag: 'index', obj, key }),

  arrow: (params: string[], body: IR): IR =>
    ({ tag: 'arrow', params, body }),

  // Single-param arrow - easier to call from Unsound
  arrow1: (param: string, body: IR): IR =>
    ({ tag: 'arrow', params: [param], body }),

  fn: (params: string[], body: IR): IR =>
    ({ tag: 'function', params, body }),

  object: (properties: { key: string; value: IR }[]): IR =>
    ({ tag: 'object', properties }),

  prop: (key: string, value: IR): { key: string; value: IR } =>
    ({ key, value }),

  /**
   * An array literal.
   */
  array: (...elements: IR[]): IR =>
    ({ tag: 'array', elements }),

  /**
   * A spread expression (e.g., ...value); should be in an array / object literal, function call,
   * or function definition.
   */
  spread: (value: IR): IR =>
    ({ tag: 'spread', value }),

  /**
   * A ternary expression (cond ? then : else).
   */
  ternary: (cond: IR, then_: IR, else_: IR): IR =>
    ({ tag: 'ternary', cond, then: then_, else: else_ }),

  /**
   * A sequence of expressions, where the value of the sequence is the value
   * of the last expression; compiled to JS using the comma operator.
   */
  seq: (...elements: IR[]): IR => {
    return {
      tag: 'seq',
      elements,
    };
  },

  // Helper for $.method(...args) pattern
  $: (method: string, ...args: IR[]): IR =>
    ir.call(ir.member(ir.var('$'), method), ...args),
};
