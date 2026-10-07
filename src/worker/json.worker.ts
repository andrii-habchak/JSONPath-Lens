/// <reference lib="webworker" />
import { JsonDocument } from '../core/document';
import type { Request, Response, WorkerApi } from './protocol';

let doc: JsonDocument | null = null;

function need(): JsonDocument {
  if (!doc) throw new Error('No document loaded');
  return doc;
}

const api: WorkerApi = {
  load(input, contentType) {
    const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
    doc = null;
    const r = JsonDocument.load(text, contentType);
    if (!r.ok) return { ok: false, error: r.error, text };
    doc = r.doc;
    return { ok: true, info: r.doc.info, visibleCount: r.doc.visibleCount };
  },
  rows: (start, count) => need().rows(start, count),
  toggle: (id) => need().toggle(id),
  setExpanded: (id, open, recursive) => need().setExpanded(id, open, recursive),
  expandAll: () => need().expandAll(),
  collapseAll: () => need().collapseAll(),
  reveal(id) {
    const d = need();
    const row = d.reveal(id);
    return { row, visibleCount: d.visibleCount };
  },
  query: (q, options) => need().query(q, options),
  clearQuery: () => need().clearQuery(),
  path: (id) => need().path(id),
  valueText: (id, pretty) => need().valueText(id, pretty),
  text: (kind) => need().text(kind),
  resultsText: (maxChars) => need().resultsText(maxChars),
  rowOf: (id) => need().rowOf(id),
  suggestions: () => need().suggestions(),
};

self.onmessage = (e: MessageEvent<Request>) => {
  const { seq, method, args } = e.data;
  let res: Response;
  try {
    const fn = api[method] as (...a: unknown[]) => unknown;
    res = { seq, ok: true, result: fn(...(args as unknown[])) };
  } catch (err) {
    res = { seq, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};
