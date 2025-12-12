/**
 * Core pre.
 */
import { writeFileSync } from "fs";

export interface PostOps {
  write: (path: string, content: string) => void;
  [key: string]: unknown;
}

export const build$post = ($: PostOps): void => {
  $.write = (path, content) => writeFileSync(path, content);
};
