/**
 * Empty language - the minimal foundation for extensions.
 *
 * Does nothing useful, but doesn't error either.
 * Running a file with --no-core produces undefined.
 */

import type { CompileOps, EmitOps, Extension, ParseOps } from './types.ts';
import { ir } from './ir.ts';

export const emptyExtension: Extension = {
  name: 'empty',
  description: 'Empty language - does nothing',

  $parse: ($: ParseOps) => {
    $.program = () => (_input, pos) => ({ ok: true, value: undefined as any, pos });
  },

  $compile: ($: CompileOps) => {
    $.compileProgram = () => ir.lit(undefined);
  },

  $emit: ($: EmitOps) => {
    $.program = () => 'export default async ($) => undefined;';
    $.programClosure = () => () => async () => undefined;
  },

};

export default emptyExtension;
