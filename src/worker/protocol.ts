import type { LoadError, LoadInfo, QueryOptions, QueryResult, Row } from '../core/types';

/** Methods the worker exposes. Arguments and results must be structured-cloneable. */
export interface WorkerApi {
  load(
    input: ArrayBuffer | string,
    contentType?: string | null,
  ): { ok: true; info: LoadInfo; visibleCount: number } | { ok: false; error: LoadError; text: string };
  rows(start: number, count: number): Row[];
  toggle(id: number): number;
  setExpanded(id: number, open: boolean, recursive: boolean): number;
  expandAll(): number;
  collapseAll(): number;
  reveal(id: number): { row: number; visibleCount: number };
  query(q: string, options: Partial<QueryOptions>): QueryResult;
  clearQuery(): number;
  path(id: number): string;
  valueText(id: number, pretty: boolean): string;
  text(kind: 'pretty' | 'original'): string;
  resultsText(maxChars?: number): { text: string; count: number; total: number };
  rowOf(id: number): number;
}

export type Method = keyof WorkerApi;

export interface Request<M extends Method = Method> {
  seq: number;
  method: M;
  args: Parameters<WorkerApi[M]>;
}

export type Response = { seq: number; ok: true; result: unknown } | { seq: number; ok: false; error: string };
