/**
 * Empty language - the minimal foundation for extensions.
 *
 * Does nothing useful, but doesn't error either.
 * Running a file with --no-core produces undefined.
 */

import type { Extension } from './types.ts';
import { ir } from './ir.ts';

export const emptyExtension: Extension = {
  name: 'empty',
  description: 'Empty language - does nothing',

  $parse: ($) => {
    $.program = () => (_input, pos) => ({ ok: true, value: undefined as any, pos });
  },

  $compile: ($) => {
    $.compileProgram = () => ir.lit(undefined);
  },

  $emit: ($) => {
    $.program = () => 'export default async ($) => undefined;';
    $.programClosure = () => () => async () => undefined;
  },

};

export default emptyExtension;
