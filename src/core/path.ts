import type { DocIndex } from './index';
import { T } from './types';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Quote a member name as a JSONPath single-quoted string literal. */
export function quoteName(name: string): string {
  let out = "'";
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "\\'";
    else if (ch === '\\') out += '\\\\';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c === 8) out += '\\b';
    else if (c === 12) out += '\\f';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + "'";
}

/** One member-name segment: `.name` or `['odd name']`. */
export function nameSegment(name: string): string {
  return IDENT.test(name) ? `.${name}` : `[${quoteName(name)}]`;
}

/** JSONPath of a node: dotted where names allow it, bracketed otherwise. */
export function pathOf(index: DocIndex, id: number): string {
  const parts: string[] = [];
  let cur = id;
  while (cur > 0) {
    const p = index.parent[cur];
    if (index.type[p] === T.Array) {
      parts.push(`[${cur - index.first[p]}]`);
    } else {
      const k = index.keys[cur] as string;
      parts.push(IDENT.test(k) ? `.${k}` : `[${quoteName(k)}]`);
    }
    cur = p;
  }
  return '$' + parts.reverse().join('');
}
