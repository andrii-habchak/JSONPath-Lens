import { JSONPathEnvironment, LOGICAL_TYPE, VALUE_TYPE } from 'json-p3';
import type { DocIndex } from './index';
import { T, type SearchScope } from './types';

/**
 * `regex(value, pattern, flags)` filter function: full JavaScript RegExp
 * semantics (flags, lookarounds) as a non-standard extension to RFC 9535.
 * Matches strings and numbers; anything else is false.
 */
class RegexFunction {
  argTypes = [VALUE_TYPE, VALUE_TYPE, VALUE_TYPE];
  returnType = LOGICAL_TYPE;
  private cache = new Map<string, RegExp | null>();

  call(value: unknown, pattern: unknown, flags: unknown): boolean {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    if (typeof pattern !== 'string') return false;
    const f = typeof flags === 'string' ? flags.replace(/[gy]/g, '') : '';
    const key = f + '/' + pattern;
    let re = this.cache.get(key);
    if (re === undefined) {
      try {
        re = new RegExp(pattern, f);
      } catch {
        re = null;
      }
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(key, re);
    }
    return re ? re.test(String(value)) : false;
  }
}

let env: JSONPathEnvironment | null = null;

export function getEnvironment(): JSONPathEnvironment {
  if (!env) {
    env = new JSONPathEnvironment({ maxRecursionDepth: 10_000, maxExpressionDepth: 100 });
    (env.functions as Record<string, unknown>)['regex'] = new RegexFunction();
  }
  return env;
}

/**
 * Left operand of `=~`: a singular query rooted at `@` or `$`
 * (dotted names, quoted names, indices, wildcards).
 */
const SUGAR =
  /((?:@|\$)(?:\.[A-Za-z_$][\w$]*|\.\*|\[\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+|\*)\s*\])*)\s*=~\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuvy]*)/g;

const SHORT_ESCAPES: Record<string, string> = { '\t': '\\t', '\n': '\\n', '\r': '\\r', '\b': '\\b', '\f': '\\f' };

/** Turn a JS regex literal body into a single-quoted JSONPath string literal. */
export function toPathString(regexBody: string): string {
  const unescapedSlash = regexBody.replace(/\\\//g, '/');
  const escaped = unescapedSlash
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    // Raw control characters are not allowed in JSONPath string literals.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, (c) => SHORT_ESCAPES[c] ?? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return "'" + escaped + "'";
}

/** Rewrite `@.x =~ /re/flags` into `regex(@.x, 're', 'flags')`. */
export function rewriteRegexSugar(query: string): { query: string; rewritten: boolean } {
  let rewritten = false;
  const out = query.replace(SUGAR, (_m, lhs: string, body: string, flags: string) => {
    rewritten = true;
    return `regex(${lhs}, ${toPathString(body)}, '${flags}')`;
  });
  return { query: out, rewritten };
}

export interface PathQueryOutcome {
  locations: (string | number)[][];
  rewritten?: string;
  error?: { message: string; position?: number };
}

/** Run a JSONPath query; returns node locations in document order. */
export function runJsonPath(query: string, data: unknown): PathQueryOutcome {
  const { query: q, rewritten } = rewriteRegexSugar(query.trim());
  try {
    const nodes = getEnvironment().query(q, data as Parameters<JSONPathEnvironment['query']>[1]);
    const locations: (string | number)[][] = [];
    for (const node of nodes) locations.push(node.location as (string | number)[]);
    return { locations, rewritten: rewritten ? q : undefined };
  } catch (e) {
    const err = e as { message?: string; span?: { start?: number } };
    const message = String(err.message ?? e);
    let position = err.span?.start;
    // Positions refer to the rewritten query; only trust them when unchanged.
    if (rewritten) position = undefined;
    return { locations: [], rewritten: rewritten ? q : undefined, error: { message, position } };
  }
}

export interface TextSearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  scope: SearchScope;
}

/** Quick search over keys and/or primitive values. Returns matching node ids. */
export function textSearch(index: DocIndex, pattern: string, opts: TextSearchOptions): { ids: number[]; error?: string } {
  if (!pattern) return { ids: [] };
  let test: (s: string) => boolean;
  if (opts.regex) {
    let re: RegExp;
    try {
      // No 'u' flag: keeps everyday patterns like \- or a{b valid.
      re = new RegExp(pattern, opts.caseSensitive ? '' : 'i');
    } catch (e) {
      return { ids: [], error: (e as Error).message };
    }
    test = (s) => re.test(s);
  } else if (opts.caseSensitive) {
    test = (s) => s.includes(pattern);
  } else {
    const p = pattern.toLowerCase();
    test = (s) => s.toLowerCase().includes(p);
  }
  const keys = opts.scope !== 'values';
  const values = opts.scope !== 'keys';
  const ids: number[] = [];
  const { type, vals } = index;
  for (let id = 1; id < index.count; id++) {
    if (keys) {
      const k = index.keys[id];
      if (k !== undefined && test(k)) {
        ids.push(id);
        continue;
      }
    }
    if (values) {
      const t = type[id];
      let s: string | undefined;
      if (t === T.String) s = vals[id] as string;
      else if (t === T.Number) s = index.bigSrc.get(id) ?? String(vals[id]);
      else if (t === T.Boolean) s = vals[id] ? 'true' : 'false';
      else if (t === T.Null) s = 'null';
      else if (t === T.Error) s = index.errors.get(id)?.raw;
      if (s !== undefined && test(s)) ids.push(id);
    }
  }
  return { ids };
}
