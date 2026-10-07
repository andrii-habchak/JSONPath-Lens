import { DocIndex } from './index';
import { parseDocument } from './parse';
import { pathOf } from './path';
import { runJsonPath, textSearch } from './query';
import { previewOf, serialize, serializeDocument } from './serialize';
import { TreeState } from './tree';
import {
  T,
  TYPE_NAMES,
  type LoadError,
  type LoadInfo,
  type QueryOptions,
  type QueryResult,
  type ResultItem,
  type Row,
} from './types';

/** How many matches get their ancestors auto-expanded after a query. */
const AUTO_EXPAND_LIMIT = 500;

export const DEFAULT_QUERY_OPTIONS: QueryOptions = {
  mode: 'auto',
  regex: false,
  caseSensitive: false,
  scope: 'both',
  limit: 10_000,
};

/**
 * A loaded document: parse result + index + tree state + current matches.
 * Pure TypeScript with no DOM or chrome.* dependencies (runs in the worker
 * and in unit tests).
 */
export class JsonDocument {
  readonly index: DocIndex;
  readonly tree: TreeState;
  readonly info: LoadInfo;
  readonly originalText: string;
  private matchFlags: Uint8Array;
  private matchIds: number[] = [];

  private constructor(text: string, index: DocIndex, info: LoadInfo) {
    this.originalText = text;
    this.index = index;
    this.info = info;
    this.tree = new TreeState(index);
    this.tree.applyDefault();
    this.matchFlags = new Uint8Array(index.count);
  }

  static load(
    text: string,
    contentType?: string | null,
  ): { ok: true; doc: JsonDocument } | { ok: false; error: LoadError } {
    const t0 = performance.now();
    const parsed = parseDocument(text, contentType);
    if (!parsed.ok) return parsed;
    const t1 = performance.now();
    const index = new DocIndex(parsed.doc);
    const t2 = performance.now();
    const info: LoadInfo = {
      kind: parsed.doc.kind,
      nodeCount: index.count,
      rootType: TYPE_NAMES[index.type[0]],
      rootSize: index.isContainer(0) ? index.size[0] : 0,
      bigInts: index.bigSrc.size > 0,
      badLines: index.errors.size,
      bytes: text.length,
      parseMs: Math.round(t1 - t0),
      indexMs: Math.round(t2 - t1),
    };
    return { ok: true, doc: new JsonDocument(text, index, info) };
  }

  get visibleCount(): number {
    return this.tree.visibleCount;
  }

  rows(start: number, count: number): Row[] {
    const { tree } = this;
    const end = Math.min(tree.visibleCount, start + count);
    const out: Row[] = [];
    for (let r = Math.max(0, start); r < end; r++) out.push(this.row(tree.visible[r]));
    return out;
  }

  row(id: number): Row {
    const { index, tree } = this;
    const p = index.parent[id];
    const t = index.type[id];
    const parentIsArray = p >= 0 && index.type[p] === T.Array;
    const row: Row = {
      id,
      parent: p,
      depth: index.depth[id],
      key: p >= 0 && !parentIsArray ? (index.keys[id] as string) : null,
      index: parentIsArray ? id - index.first[p] : null,
      type: TYPE_NAMES[t],
      preview: t === T.Object || t === T.Array ? '' : previewOf(index, id),
      size: index.isContainer(id) ? index.size[id] : 0,
      expanded: !!tree.expanded[id],
      match: this.matchFlags[id] === 1,
    };
    if (index.isNdjson && p === 0) row.line = index.lineOf(id);
    if (t === T.Error) row.error = index.errors.get(id)?.message;
    return row;
  }

  toggle(id: number): number {
    this.tree.toggle(id);
    return this.tree.visibleCount;
  }

  setExpanded(id: number, open: boolean, recursive: boolean): number {
    this.tree.setExpanded(id, open, recursive);
    return this.tree.visibleCount;
  }

  expandAll(): number {
    this.tree.expandAll();
    return this.tree.visibleCount;
  }

  collapseAll(): number {
    this.tree.collapseAll();
    return this.tree.visibleCount;
  }

  /** Make a node visible; returns its row index. */
  reveal(id: number): number {
    return this.tree.reveal(id);
  }

  rowOf(id: number): number {
    return this.tree.rowOf[id];
  }

  path(id: number): string {
    return pathOf(this.index, id);
  }

  /** Pretty (indent 2) or compact text of a node. */
  valueText(id: number, pretty = true): string {
    return serialize(this.index, id, pretty ? 2 : 0);
  }

  /** Full text: 'pretty' re-serializes, 'original' returns the text as received. */
  text(kind: 'pretty' | 'original'): string {
    if (kind === 'original') return this.originalText;
    if (this.index.isNdjson) return serializeDocument(this.index, 2);
    return serialize(this.index, 0, 2);
  }

  /** Matched values as a pretty JSON array. */
  resultsText(): string {
    const parts = this.matchIds.map((id) => serialize(this.index, id, 2).replace(/\n/g, '\n  '));
    return parts.length ? '[\n  ' + parts.join(',\n  ') + '\n]' : '[]';
  }

  clearQuery(): number {
    for (const id of this.matchIds) this.matchFlags[id] = 0;
    this.matchIds = [];
    return this.tree.visibleCount;
  }

  query(q: string, options: Partial<QueryOptions> = {}): QueryResult {
    const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
    const t0 = performance.now();
    this.clearQuery();
    const trimmed = q.trim();
    const empty: QueryResult = {
      mode: 'none',
      total: 0,
      results: [],
      firstIndex: -1,
      visibleCount: this.tree.visibleCount,
      ms: 0,
    };
    if (!trimmed) return empty;

    const usePath = opts.mode === 'jsonpath' || (opts.mode === 'auto' && trimmed.startsWith('$'));
    let ids: number[] = [];
    let error: QueryResult['error'];
    let rewritten: string | undefined;
    let mode: QueryResult['mode'];

    if (usePath) {
      mode = 'jsonpath';
      const out = runJsonPath(trimmed, this.index.vals[0]);
      error = out.error;
      rewritten = out.rewritten;
      for (const loc of out.locations) {
        const id = this.index.resolve(loc);
        if (id >= 0) ids.push(id);
      }
    } else {
      mode = opts.regex ? 'regex' : 'text';
      const out = textSearch(this.index, trimmed, opts);
      ids = out.ids;
      if (out.error) error = { message: out.error };
    }

    // De-duplicate (JSONPath may return a node more than once).
    const unique: number[] = [];
    for (const id of ids) {
      if (!this.matchFlags[id]) {
        this.matchFlags[id] = 1;
        unique.push(id);
      }
    }
    this.matchIds = unique;

    this.tree.openAncestors(unique.slice(0, AUTO_EXPAND_LIMIT));
    this.tree.recompute();

    const results: ResultItem[] = [];
    const limit = Math.min(unique.length, opts.limit);
    for (let i = 0; i < limit; i++) {
      const id = unique[i];
      const item: ResultItem = {
        id,
        path: pathOf(this.index, id),
        type: TYPE_NAMES[this.index.type[id]],
        preview: previewOf(this.index, id, 120),
      };
      if (this.index.isNdjson) item.line = this.index.lineOf(id);
      results.push(item);
    }

    return {
      mode,
      total: unique.length,
      results,
      error,
      rewritten,
      firstIndex: unique.length ? this.tree.rowOf[unique[0]] : -1,
      visibleCount: this.tree.visibleCount,
      ms: Math.round(performance.now() - t0),
    };
  }

  /** Ids of all current matches (document order). */
  get matches(): readonly number[] {
    return this.matchIds;
  }
}
