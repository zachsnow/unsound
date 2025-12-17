/**
 * Generate embedded source files as a JSON file for inclusion in bundled builds.
 */
import fs from 'fs/promises';
import { Glob } from 'bun';
import { Logger } from './logger';

const logger = new Logger('embed');

type Ignore = {
  glob: Glob;
  pattern: string;
}

const loadIgnores = async () => {
  // Load ignore.
  const ignoresExists = await fs.exists('.embedignore');
  if (!ignoresExists) {
    logger.debug("no .embedignore found");
    return [];
  }
  logger.debug("loading .embedignore...");
  const ignore = await fs.readFile('.embedignore', 'utf-8');

  // Parse patterns.
  const ignorePatterns = ignore.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const ignores = ignorePatterns.map(pattern => ({
    glob: new Glob(pattern),
    pattern,
  }));
  logger.debug(`loaded ${ignores.length} ignore patterns.`);
  return ignores;
};

const findIgnore = (path: string, ignores: Ignore[]) => {
  for (const ignore of ignores) {
    if (ignore.glob.match(path)) {
      return ignore;
    }
  }
  return false;
};

const readSource = async (path: string) => {
  const content = await fs.readFile(path, 'utf-8');
  return { path, content };
};

const parseArgs = (args: string[]) => {
  if (args.includes('--help') || args.includes('-h')) {
    logger.info('Usage: embed-sources.ts');
    logger.info('Generates embedded-sources.json containing all source files for embedding.');
    process.exit(0);
  }

  if (args.includes('--verbose') || args.includes('-v')) {
    logger.setVerbose(true);
  }
}

const main = async () => {
  // Parse arguments.
  const args = process.argv.slice(2);
  parseArgs(args);

  // Change CWD to src/ so that globbing works correctly.
  logger.debug(`changing cwd to src/ (${import.meta.dir})...`);
  process.chdir(import.meta.dir);

  // Load ignore patterns.
  const ignores = await loadIgnores();

  // Embed all .ts files from src/, ignoring files that match .embedignore.
  logger.debug('embedding source files...');
  const glob = new Glob('**/*.ts');
  const scan = await Array.fromAsync(glob.scan());
  const sources = await Promise.all(scan.map(file => {
    // Check ignore.
    const ignore = findIgnore(file, ignores);
    if (ignore) {
      logger.debug(`ignoring ${file} due to pattern ${ignore.pattern}`);
      return null;
    }

    logger.debug(`embedding ${file}...`);
    return readSource(file);
  }).filter(source => source !== null));
  logger.debug(`embedded ${sources.length} source files`);

  // Build a map from path to content.
  const sourcesMap: Record<string, string> = {};
  for (const source of sources) {
    sourcesMap[source.path] = source.content;
  }

  // Write the map to embedded-sources.json.
  await fs.writeFile('../embedded-sources.json', JSON.stringify(sourcesMap, null, 2));
  logger.info('Generated embedded-sources.json');
  process.exit(0);
};

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});

