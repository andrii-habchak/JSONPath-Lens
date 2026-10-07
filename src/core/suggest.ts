import type { DocIndex } from './index';
import { nameSegment, pathOf, quoteName } from './path';
import { T } from './types';

export interface Suggestion {
  query: string;
  description: string;
}

/** Find the first array whose first item is an object with at least one primitive member (breadth-first). */
function firstObjectArray(index: DocIndex): number {
  const limit = Math.min(index.count, 200_000);
  for (let id = 0; id < limit; id++) {
    if (index.type[id] !== T.Array || index.size[id] === 0) continue;
    const item = index.first[id];
    if (index.type[item] !== T.Object) continue;
    const f = index.first[item];
    for (let c = f; c < f + index.size[item]; c++) {
      const t = index.type[c];
      if (t === T.String || t === T.Number || t === T.Boolean) return id;
    }
  }
  return -1;
}

function literal(index: DocIndex, id: number): string {
  const t = index.type[id];
  const v = index.vals[id];
  if (t === T.String) return quoteName(String(v).slice(0, 40));
  if (t === T.Number) return index.bigSrc.get(id) ?? String(v);
  return String(v);
}

/**
 * Example JSONPath queries built from the loaded document, so the hints show
 * syntax with the document's own names.
 */
export function suggestQueries(index: DocIndex): Suggestion[] {
  const arr = firstObjectArray(index);
  if (arr < 0) return [];
  const P = pathOf(index, arr);
  const item = index.first[arr];
  const f = index.first[item];
  let str = -1;
  let num = -1;
  let bool = -1;
  let child = -1; // a nested array or object member
  for (let c = f; c < f + index.size[item]; c++) {
    const t = index.type[c];
    if (t === T.String && str < 0 && (index.vals[c] as string).length > 0) str = c;
    else if (t === T.Number && num < 0) num = c;
    else if (t === T.Boolean && bool < 0) bool = c;
    else if (t === T.Array && child < 0) child = c;
  }
  const key = (id: number) => nameSegment(index.keys[id] as string);
  const out: Suggestion[] = [];
  const n = index.size[arr];
  out.push({ query: `${P}[*]`, description: `All ${n} items of ${P}` });
  if (str >= 0) out.push({ query: `${P}[*]${key(str)}`, description: `Only the ${index.keys[str]} of every item` });
  out.push({ query: `${P}[0]`, description: 'The first item' });
  out.push({ query: `${P}[-1]`, description: 'The last item' });
  out.push({ query: `${P}[0:3]`, description: 'The first three items (slice)' });
  if (str >= 0) {
    out.push({ query: `${P}[?@${key(str)} == ${literal(index, str)}]`, description: `Items whose ${index.keys[str]} equals a value` });
    const v = String(index.vals[str]);
    const prefix = v.slice(0, Math.min(4, v.length)).replace(/[\\/^$.*+?()[\]{}|]/g, '\\$&');
    out.push({
      query: `${P}[?@${key(str)} =~ /^${prefix}/i]${key(str)}`,
      description: `${index.keys[str]} values starting with "${v.slice(0, 4)}" (regex, case-insensitive)`,
    });
  }
  if (num >= 0) {
    out.push({
      query: `${P}[?@${key(num)} > ${literal(index, num)}]`,
      description: `Items whose ${index.keys[num]} is greater than a number`,
    });
  }
  if (bool >= 0) out.push({ query: `${P}[?@${key(bool)} == true]`, description: `Items where ${index.keys[bool]} is true` });
  if (child >= 0) {
    out.push({ query: `${P}[?count(@${key(child)}[*]) > 2]`, description: `Items with more than 2 ${index.keys[child]}` });
  }
  if (str >= 0) out.push({ query: `$.${key(str)}`, description: `Every ${index.keys[str]} at any depth` });
  return out;
}
