#!/usr/bin/env bun
// Generates embedded-sources.json with source code as strings

import fs from 'fs';

const sourceFiles = [
  'analyze.ts',
  'ast.ts',
  'compile-helpers.ts',
  'compile.ts',
  'emit.ts',
  'empty.ts',
  'extension.ts',
  'interpret.ts',
  'ir.ts',
  'parse.ts',
  'post.ts',
  'pre.ts',
  'pretty.ts',
  'util.ts',
  'extensions/core.ts',
  'extensions/trace.ts',
];

const sources: Record<string, string> = {};

for (const file of sourceFiles) {
  sources[file] = fs.readFileSync(file, 'utf-8');
}

fs.writeFileSync('embedded-sources.json', JSON.stringify(sources, null, 2));
console.log('Generated embedded-sources.json');
