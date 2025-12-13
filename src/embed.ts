#!/usr/bin/env bun

/**
 * Generate embedded source files as a JSON file for inclusion in bundled builds.
 */
import fs from 'fs';
import { Glob } from 'bun';

const sources: Record<string, string> = {};

// Embed all .ts files from src/ and src/extensions/
const glob = new Glob('**/*.ts');
for (const file of glob.scanSync('.')) {
  // Skip test files and this embed script itself
  if (file.endsWith('.test.ts') || file === 'embed.ts') {
    continue;
  }
  sources[file] = fs.readFileSync(file, 'utf-8');
}

fs.writeFileSync('../embedded-sources.json', JSON.stringify(sources, null, 2));
console.log('Generated embedded-sources.json');
