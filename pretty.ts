// Deterministic pretty-printer for values
// Used by CLI, test framework, and tracing for consistent output

export type Compact = 'always' | 'auto' | 'never';

export function prettyPrint(
  value: unknown,
  compact: Compact = 'always',
  seen = new Set<unknown>(),
  indent = 0
): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;
  if (type === 'number' || type === 'boolean') return String(value);
  if (type === 'string') return JSON.stringify(value);
  if (type === 'function') return '<function>';

  if (type === 'object') {
    if (seen.has(value)) return '<circular>';
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      // Multi-line arrays when not compact and contains objects
      const hasObjects = value.some(v => typeof v === 'object' && v !== null);
      const multiLine = hasObjects && compact !== 'always';
      if (multiLine) {
        const ws = '  '.repeat(indent / 2 + 1);
        const closeWs = '  '.repeat(indent / 2);
        const items = value.map(v => ws + prettyPrint(v, compact, seen, indent + 2));
        return '[\n' + items.join(',\n') + '\n' + closeWs + ']';
      } else {
        const items = value.map(v => prettyPrint(v, compact, seen, indent));
        return '[' + items.join(', ') + ']';
      }
    }

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    if (keys.length === 0) return '{}';

    // Determine if we should use multi-line formatting
    const isCode = 'type' in obj || 'tag' in obj;
    const multiLine = compact === 'never' || (compact === 'auto' && isCode);

    if (multiLine) {
      const ws = '  '.repeat(indent / 2 + 1);
      const closeWs = '  '.repeat(indent / 2);
      const pairs = keys.map(k =>
        `${ws}${JSON.stringify(k)}: ${prettyPrint(obj[k], compact, seen, indent + 2)}`
      );
      return '{\n' + pairs.join(',\n') + '\n' + closeWs + '}';
    } else {
      const pairs = keys.map(k =>
        `${JSON.stringify(k)}: ${prettyPrint(obj[k], compact, seen, indent)}`
      );
      return '{' + pairs.join(', ') + '}';
    }
  }

  return String(value);
}
