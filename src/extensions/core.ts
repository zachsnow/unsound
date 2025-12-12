// core.ts - Core Unsound language.
//
// Provides the core implementations for all phases:
//   $pre: file reading
//   $parse: base parser
//   $compile: base compiler
//   $emit: JS code generation
//   $post: file writing
//   $interpret: base interpreter
//
// Without this extension, the language is empty (can't even parse "").
import type { Extension } from '../extension.ts';
import { build$pre } from '../pre.ts';
import { build$parse } from '../parse.ts';
import { build$compile } from '../compile.ts';
import { build$emit } from '../emit.ts';
import { build$post } from '../post.ts';
import { build$interpret, defaultEnv } from '../interpret.ts';
import { build$analyze } from '../analyze.ts';

export const coreExtension: Extension = {
  name: 'core',
  description: 'Core extension providing base implementations for all phases',
  version: '1.0.0',

  $pre: ($) => {
    build$pre($);
  },

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

  $post: ($) => {
    build$post($);
  },

  $interpret: ($) => {
    build$interpret($, defaultEnv);
  },

  $analyze: ($) => {
    build$analyze($);
  },
};

export default coreExtension;
