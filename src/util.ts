export const fix = <Ops>(f: (ops: Ops) => void): Ops => {
  const $ = {} as Ops;
  f($);
  return $;
};
