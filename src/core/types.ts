/** Node type codes stored in the index (Uint8Array). */
export const T = {
  Object: 0,
  Array: 1,
  String: 2,
  Number: 3,
  Boolean: 4,
  Null: 5,
  /** An NDJSON line that failed to parse. */
  Error: 6,
} as const;

export type TypeCode = (typeof T)[keyof typeof T];

export const TYPE_NAMES = ['object', 'array', 'string', 'number', 'boolean', 'null', 'error'] as const;
export type TypeName = (typeof TYPE_NAMES)[number];

export type DocKind = 'json' | 'ndjson';

export type SearchScope = 'both' | 'keys' | 'values';

export type QueryMode = 'auto' | 'jsonpath' | 'text';

export interface QueryOptions {
  /** 'auto' runs JSONPath when the query starts with `$`, quick search otherwise. */
  mode: QueryMode;
  /** Quick search only: treat the query as a regular expression. */
  regex: boolean;
  /** Quick search only. */
  caseSensitive: boolean;
  /** Quick search only. */
  scope: SearchScope;
  /** Max results returned with paths/previews (total is always exact). */
  limit: number;
}

export interface Row {
  id: number;
  /** Parent node id, -1 for the root. */
  parent: number;
  depth: number;
  /** Object member name; null for root and array items. */
  key: string | null;
  /** Array index; null for root and object members. */
  index: number | null;
  type: TypeName;
  /** Primitive: JSON-ish text, truncated. Container: empty string. */
  preview: string;
  /** Number of children for containers, 0 otherwise. */
  size: number;
  expanded: boolean;
  match: boolean;
  /** NDJSON: 1-based source line of a top-level item. */
  line?: number;
  /** NDJSON: parse error message of a bad line. */
  error?: string;
}

export interface ResultItem {
  id: number;
  path: string;
  type: TypeName;
  preview: string;
  line?: number;
}

export interface LoadInfo {
  kind: DocKind;
  nodeCount: number;
  rootType: TypeName;
  /** Number of children of the root (NDJSON: number of lines). */
  rootSize: number;
  /** True when at least one integer outside ±2^53 kept its exact digits. */
  bigInts: boolean;
  /** NDJSON: number of lines that failed to parse. */
  badLines: number;
  bytes: number;
  parseMs: number;
  indexMs: number;
}

export interface LoadError {
  message: string;
  line: number;
  column: number;
  offset: number;
}

export interface QueryResult {
  mode: 'jsonpath' | 'text' | 'regex' | 'none';
  total: number;
  results: ResultItem[];
  error?: { message: string; position?: number };
  /** JSONPath actually executed when `=~` sugar was rewritten. */
  rewritten?: string;
  /** Visible-row index of the first match after auto-expanding. */
  firstIndex: number;
  visibleCount: number;
  ms: number;
}
