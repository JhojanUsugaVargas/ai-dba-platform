// Nothing leaves the perimeter towards the LLM without passing through here.
// Removes SQL literals, e-mails and long digit runs from string values; drops secret-looking keys.
import { redactSecrets } from '../core/util.ts';

function scrub(s: string): string {
  return s
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/\b\d{9,}\b/g, '<number>');
}

export function redactForLlm<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(redactSecrets(value)) as T;
}
