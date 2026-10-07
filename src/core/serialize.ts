import type { DocIndex } from './index';
import { T } from './types';

/** Text of a primitive node (big integers keep their source digits). */
export function primitiveText(index: DocIndex, id: number): string {
  const t = index.type[id];
  const v = index.vals[id];
  switch (t) {
    case T.String:
      return JSON.stringify(v);
    case T.Number: {
      const src = index.bigSrc.get(id);
      if (src) return src;
      return Number.isFinite(v as number) ? String(v) : 'null';
    }
    case T.Boolean:
      return v ? 'true' : 'false';
    case T.Null:
      return 'null';
    case T.Error:
      return index.errors.get(id)?.raw ?? 'null';
    default:
      return '';
  }
}

/** Short single-line preview used in tree rows and result lists. */
export function previewOf(index: DocIndex, id: number, max = 200): string {
  const t = index.type[id];
  if (t === T.Object) return `{${index.size[id]}}`;
  if (t === T.Array) return `[${index.size[id]}]`;
  if (t === T.String) {
    const s = index.vals[id] as string;
    const cut = s.length > max ? s.slice(0, max) : s;
    const q = JSON.stringify(cut);
    return s.length > max ? q.slice(0, -1) + '…"' : q;
  }
  const txt = primitiveText(index, id);
  return txt.length > max ? txt.slice(0, max) + '…' : txt;
}

const holderCache = new WeakMap<DocIndex, WeakMap<object, Map<string, string>>>();

/** Big-integer digits keyed by holder object and member name / index. */
function bigHolders(index: DocIndex): WeakMap<object, Map<string, string>> {
  let holders = holderCache.get(index);
  if (!holders) {
    holders = new WeakMap();
    for (const [id, digits] of index.bigSrc) {
      const p = index.parent[id];
      if (p < 0) continue;
      const h = index.vals[p] as object;
      let m = holders.get(h);
      if (!m) holders.set(h, (m = new Map()));
      m.set(index.keys[id] ?? String(id - index.first[p]), digits);
    }
    holderCache.set(index, holders);
  }
  return holders;
}

type RawJson = { rawJSON?: (text: string) => unknown };

/**
 * Serialize a subtree. Uses native JSON.stringify (with JSON.rawJSON for big
 * integers) and falls back to an iterative writer for pathological depth.
 * NDJSON error items serialize to their raw line.
 */
export function serialize(index: DocIndex, id: number, indent = 2): string {
  const t = index.type[id];
  if (t !== T.Object && t !== T.Array) return primitiveText(index, id);
  const rawJSON = (JSON as unknown as RawJson).rawJSON;
  const hasErrors = index.errors.size > 0;
  if (index.bigSrc.size === 0 || rawJSON) {
    try {
      if (index.bigSrc.size === 0 && !hasErrors) {
        return JSON.stringify(index.vals[id], null, indent || undefined);
      }
      if (!hasErrors && rawJSON) {
        const holders = bigHolders(index);
        return JSON.stringify(
          index.vals[id],
          function (this: object, key: string, value: unknown) {
            if (typeof value === 'number') {
              const digits = holders.get(this)?.get(key);
              if (digits) return rawJSON(digits);
            }
            return value;
          },
          indent || undefined,
        );
      }
    } catch (e) {
      // Too deep for native stringify -> iterative writer. A result too large for
      // a JS string would fail there as well, so rethrow that one.
      if (e instanceof RangeError && /string length/i.test(e.message)) throw e;
    }
  }
  return serializeIterative(index, id, indent);
}

/** Iterative writer: no recursion limits, exact big integers, raw error lines. */
export function serializeIterative(index: DocIndex, id: number, indent = 2): string {
  const out: string[] = [];
  const pretty = indent > 0;
  const pad = (d: number) => (pretty ? '\n' + ' '.repeat(indent * d) : '');
  const sep = pretty ? ': ' : ':';

  // Frame: node id, next child offset, depth.
  const stack: [number, number, number][] = [];
  const open = (nid: number, depth: number) => {
    const t = index.type[nid];
    if (t === T.Object || t === T.Array) {
      if (index.size[nid] === 0) {
        out.push(t === T.Object ? '{}' : '[]');
        return;
      }
      out.push(t === T.Object ? '{' : '[');
      stack.push([nid, 0, depth]);
    } else {
      out.push(primitiveText(index, nid));
    }
  };

  open(id, 0);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const [nid, pos, depth] = frame;
    const n = index.size[nid];
    if (pos >= n) {
      stack.pop();
      out.push(pad(depth) + (index.type[nid] === T.Object ? '}' : ']'));
      continue;
    }
    frame[1] = pos + 1;
    const cid = index.first[nid] + pos;
    out.push((pos > 0 ? ',' : '') + pad(depth + 1));
    if (index.type[nid] === T.Object) {
      out.push(JSON.stringify(index.keys[cid]) + sep);
    }
    open(cid, depth + 1);
  }
  return out.join('');
}

/** Whole-document text: NDJSON becomes one compact value per line. */
export function serializeDocument(index: DocIndex, indent = 2): string {
  if (!index.isNdjson) return serialize(index, 0, indent);
  const parts: string[] = [];
  const first = index.first[0];
  for (let i = 0; i < index.size[0]; i++) parts.push(serialize(index, first + i, 0));
  return parts.join('\n') + '\n';
}
