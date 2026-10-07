import { BIG_PREFIX, type NdError, type ParsedDoc } from './parse';
import { T, type TypeCode } from './types';

/**
 * Flat, typed-array index over a parsed document.
 *
 * Node ids are assigned breadth-first, so the children of every container
 * occupy the contiguous id range [first[id], first[id] + size[id]).
 * Node 0 is the root.
 */
export class DocIndex {
  count = 0;
  parent: Int32Array;
  type: Uint8Array;
  first: Int32Array;
  size: Int32Array;
  depth: Int32Array;
  /** Object member names (undefined for array items and root). */
  keys: (string | undefined)[] = [];
  /** The JS value at each node (primitive or container reference). */
  vals: unknown[] = [];
  /** Exact source digits for unsafe integers. */
  bigSrc = new Map<number, string>();
  /** NDJSON: errors for bad lines by node id. */
  errors = new Map<number, NdError>();
  /** NDJSON: 1-based line number of each top-level item (index = item position). */
  lines: number[] | null = null;
  readonly isNdjson: boolean;
  private keyMaps = new Map<number, Map<string, number>>();

  constructor(doc: ParsedDoc) {
    this.isNdjson = doc.kind === 'ndjson';
    let cap = 1024;
    this.parent = new Int32Array(cap);
    this.type = new Uint8Array(cap);
    this.first = new Int32Array(cap);
    this.size = new Int32Array(cap);
    this.depth = new Int32Array(cap);

    const grow = (need: number) => {
      if (need <= cap) return;
      while (cap < need) cap *= 2;
      this.parent = resize(this.parent, cap);
      this.type = resize(this.type, cap);
      this.first = resize(this.first, cap);
      this.size = resize(this.size, cap);
      this.depth = resize(this.depth, cap);
    };

    const big = doc.hasBigInts;
    // Root
    this.count = 1;
    this.parent[0] = -1;
    this.depth[0] = 0;
    this.keys[0] = undefined;
    let root = doc.root;
    if (big && isBig(root)) {
      root = this.unbox(0, root as string);
      doc.root = root;
    }
    this.vals[0] = root;
    this.type[0] = typeOf(root);
    if (doc.kind === 'ndjson') this.lines = doc.lines ?? null;

    for (let id = 0; id < this.count; id++) {
      const t = this.type[id];
      if (t !== T.Object && t !== T.Array) continue;
      const v = this.vals[id] as Record<string, unknown> | unknown[];
      const start = this.count;
      this.first[id] = start;
      const d = this.depth[id] + 1;
      if (t === T.Array) {
        const arr = v as unknown[];
        const n = arr.length;
        grow(start + n);
        for (let i = 0; i < n; i++) {
          const cid = start + i;
          let cv = arr[i];
          if (big && isBig(cv)) cv = arr[i] = this.unbox(cid, cv as string);
          this.parent[cid] = id;
          this.depth[cid] = d;
          this.vals[cid] = cv;
          this.keys[cid] = undefined;
          this.type[cid] = typeOf(cv);
          this.first[cid] = 0;
          this.size[cid] = 0;
        }
        this.size[id] = n;
        this.count = start + n;
      } else {
        const obj = v as Record<string, unknown>;
        const ks = Object.keys(obj);
        const n = ks.length;
        grow(start + n);
        for (let i = 0; i < n; i++) {
          const cid = start + i;
          const k = ks[i];
          let cv = obj[k];
          if (big && isBig(cv)) cv = obj[k] = this.unbox(cid, cv as string);
          this.parent[cid] = id;
          this.depth[cid] = d;
          this.vals[cid] = cv;
          this.keys[cid] = k;
          this.type[cid] = typeOf(cv);
          this.first[cid] = 0;
          this.size[cid] = 0;
        }
        this.size[id] = n;
        this.count = start + n;
      }
    }

    if (doc.kind === 'ndjson' && doc.errors) {
      const base = this.first[0];
      for (const [item, err] of doc.errors) {
        const cid = base + item;
        this.type[cid] = T.Error;
        this.errors.set(cid, err);
      }
    }
  }

  /** Turn a big-integer placeholder back into a number, remembering its digits. */
  private unbox(id: number, placeholder: string): number {
    const digits = placeholder.slice(BIG_PREFIX.length);
    const n = Number(digits);
    if (!Number.isSafeInteger(n)) this.bigSrc.set(id, digits);
    return n;
  }

  isContainer(id: number): boolean {
    const t = this.type[id];
    return t === T.Object || t === T.Array;
  }

  /** Child id for a member name / array index, or -1. */
  child(id: number, key: string | number): number {
    const t = this.type[id];
    const first = this.first[id];
    const n = this.size[id];
    if (t === T.Array) {
      const i = typeof key === 'number' ? key : Number(key);
      if (!Number.isInteger(i)) return -1;
      const idx = i < 0 ? n + i : i;
      return idx >= 0 && idx < n ? first + idx : -1;
    }
    if (t !== T.Object) return -1;
    const k = String(key);
    if (n <= 16) {
      for (let c = first; c < first + n; c++) if (this.keys[c] === k) return c;
      return -1;
    }
    let m = this.keyMaps.get(id);
    if (!m) {
      m = new Map();
      for (let c = first; c < first + n; c++) m.set(this.keys[c] as string, c);
      this.keyMaps.set(id, m);
    }
    return m.get(k) ?? -1;
  }

  /** Resolve a JSONPath location (list of names/indices) to a node id. */
  resolve(location: readonly (string | number)[]): number {
    let id = 0;
    for (const step of location) {
      id = this.child(id, step);
      if (id < 0) return -1;
    }
    return id;
  }

  /** Position of a node within its parent (array index or member order). */
  indexInParent(id: number): number {
    const p = this.parent[id];
    return p < 0 ? -1 : id - this.first[p];
  }

  /** NDJSON: source line of the top-level item that contains `id`. */
  lineOf(id: number): number | undefined {
    if (!this.lines || id === 0) return undefined;
    let cur = id;
    while (this.parent[cur] !== 0) cur = this.parent[cur];
    return this.lines[this.indexInParent(cur)];
  }
}

function isBig(v: unknown): boolean {
  return typeof v === 'string' && v.charCodeAt(0) === 0 && v.startsWith(BIG_PREFIX);
}

function typeOf(v: unknown): TypeCode {
  if (v === null) return T.Null;
  if (Array.isArray(v)) return T.Array;
  switch (typeof v) {
    case 'object':
      return T.Object;
    case 'string':
      return T.String;
    case 'number':
      return T.Number;
    case 'boolean':
      return T.Boolean;
    default:
      return T.Null;
  }
}

function resize<A extends Int32Array | Uint8Array>(a: A, cap: number): A {
  const b = new (a.constructor as new (n: number) => A)(cap);
  b.set(a);
  return b;
}
