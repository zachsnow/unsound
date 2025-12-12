import { readFileSync } from 'fs';

/**
 * Core pre.
 */
export interface PreOps {
  read: (path: string) => string;
  [key: string]: unknown;
}

export const build$pre = ($: PreOps): void => {
  $.read = (path) => readFileSync(path, 'utf-8');
};
