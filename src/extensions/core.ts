// core.ts - Core Unsound language.
//
// Provides the core implementations for all phases:
//   $parse: base parser
//   $compile: base compiler
//   $emit: JS code generation
//   $interpret: base interpreter
//
// Without this extension, the language is empty (can't even parse "").
import type { Extension } from '../types.ts';
import { build$parse } from '../parse.ts';
import { build$compile } from '../compile.ts';
import { build$emit } from '../emit.ts';
import { build$interpret } from '../interpret.ts';
import { build$analyze } from '../analyze.ts';

export const coreExtension: Extension = {
  name: 'core',
  description: 'Core extension providing base implementations for all phases',
  version: '1.0.0',

  $parse: build$parse,
  $compile: build$compile,
  $emit: build$emit,
  $interpret: build$interpret,
  $analyze: build$analyze,
};

export default coreExtension;
