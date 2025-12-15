// core.ts - Core Unsound language.
//
// Provides the core implementations for all phases:
//   $parse: base parser
//   $compile: base compiler
//   $emit: JS code generation
//   $interpret: base interpreter
//
// Without this extension, the language is empty (can't even parse "").
import type { Extension, ParseOps } from '../types.ts';
import { build$parse } from '../parse.ts';
import { build$compile } from '../compile.ts';
import { build$emit } from '../emit.ts';
import { build$interpret, defaultEnv } from '../interpret.ts';
import { build$analyze } from '../analyze.ts';
import { Expr } from '../ast.ts';
import { IR } from '../ir.ts';

export type CoreExtension = Extension<string, Expr, IR>

export const coreExtension: CoreExtension = {
  name: 'core',
  description: 'Core extension providing base implementations for all phases',
  version: '1.0.0',

  $parse: ($) => {
    // Build parser ops directly on $ so closures reference the right object
    build$parse($);
  },

  $compile: ($) => {
    // Build compiler ops directly on $ so closures reference the right object
    build$compile($);
  },

  $emit: ($) => {
    build$emit($);
  },

  $interpret: ($) => {
    build$interpret($, defaultEnv);
  },

  $analyze: ($) => {
    build$analyze($);
  },
};

export default coreExtension;
