export const fix = <Ops>(f: (ops: Ops) => void): Ops => {
  const $ = {} as Ops;
  f($);
  return $;
};

/**
 * Given a string and a position in the string, returns the line and column of the position
 * by counting newlines.
 */
export function posToLineCol(source: string, pos: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export class UnhandledCaseError extends Error {
  constructor(message: string, value: never) {
    super(`${message}: unhandled case: ${JSON.stringify(value)}`);
  }
}
