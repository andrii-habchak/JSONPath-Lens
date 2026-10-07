import type { DocKind, LoadError } from './types';

/**
 * Prefix of the placeholder string that stands in for a big integer while
 * parsing. Big integers are rewritten to `"\u0000\u0001<digits>"` strings
 * before `JSON.parse` and turned back into numbers by the indexer, which
 * keeps the exact digits. This is ~8x faster than a reviver on large payloads.
 */
export const BIG_PREFIX = '\u0000\u0001';
/** The same prefix as JSON escape text, inserted into the source before parsing. */
const BIG_PREFIX_JSON = '\\u0000\\u0001';

export interface NdError {
  message: string;
  raw: string;
}

export interface ParsedDoc {
  kind: DocKind;
  /** For NDJSON: a virtual array with one item per non-empty line. */
  root: unknown;
  /** True when big-integer placeholders may be present in the parsed values. */
  hasBigInts: boolean;
  /** NDJSON: 1-based source line per item. */
  lines?: number[];
  /** NDJSON: parse errors by item index. */
  errors?: Map<number, NdError>;
}

export type ParseOutcome = { ok: true; doc: ParsedDoc } | { ok: false; error: LoadError };

const XSSI_PREFIXES = [")]}',\n", ")]}'\n", ")]}',", ")]}'", 'while(1);', 'for(;;);', 'while (1);'];

/** Strip a UTF-8 BOM and common anti-XSSI prefixes. */
export function cleanText(text: string): string {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const lead = t.trimStart();
  for (const p of XSSI_PREFIXES) {
    if (lead.startsWith(p)) return lead.slice(p.length);
  }
  return t;
}

const NDJSON_TYPES = /(?:x-ndjson|ndjson|jsonl|json-lines|jsonlines|x-json-stream|json-seq)/i;

export function isNdjsonContentType(contentType?: string | null): boolean {
  return !!contentType && NDJSON_TYPES.test(contentType);
}

/**
 * Wrap integer literals with 16+ digits (outside strings) into placeholder
 * strings so their digits survive `JSON.parse`. Returns the input unchanged
 * when there are none.
 */
export function protectBigInts(s: string): { text: string; count: number } {
  const parts: string[] = [];
  let last = 0;
  let count = 0;
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 34) {
      // Skip a string literal (with escapes).
      i++;
      while (i < n) {
        const d = s.charCodeAt(i);
        if (d === 92) i += 2;
        else if (d === 34) {
          i++;
          break;
        } else i++;
      }
      continue;
    }
    if ((c >= 48 && c <= 57) || c === 45) {
      const start = i;
      i++;
      while (i < n) {
        const d = s.charCodeAt(i);
        if (d >= 48 && d <= 57) i++;
        else break;
      }
      const digits = i - start - (c === 45 ? 1 : 0);
      const next = s.charCodeAt(i);
      const isFloat = next === 46 || next === 101 || next === 69;
      if (digits >= 16 && !isFloat) {
        parts.push(s.slice(last, start), '"', BIG_PREFIX_JSON, s.slice(start, i), '"');
        last = i;
        count++;
      } else {
        // Skip the rest of a number (fraction / exponent).
        while (i < n) {
          const d = s.charCodeAt(i);
          if ((d >= 48 && d <= 57) || d === 46 || d === 101 || d === 69 || d === 43 || d === 45) i++;
          else break;
        }
      }
      continue;
    }
    i++;
  }
  if (!count) return { text: s, count };
  parts.push(s.slice(last));
  return { text: parts.join(''), count };
}

/** Parse one JSON text; big integers come back as placeholder strings. */
function parseOne(text: string): { value: unknown; big: boolean } {
  if (!MAYBE_BIG_INT.test(text)) return { value: JSON.parse(text), big: false };
  const p = protectBigInts(text);
  if (!p.count) return { value: JSON.parse(text), big: false };
  try {
    return { value: JSON.parse(p.text), big: true };
  } catch {
    // Report errors against the original text.
    return { value: JSON.parse(text), big: false };
  }
}

/** Integers with 16+ digits may exceed 2^53. */
const MAYBE_BIG_INT = /\d{16,}/;

/** Parse text as JSON, falling back to NDJSON when appropriate. */
export function parseDocument(rawText: string, contentType?: string | null): ParseOutcome {
  const text = cleanText(rawText);

  if (isNdjsonContentType(contentType)) {
    return { ok: true, doc: parseNdjson(text) };
  }

  try {
    const { value, big } = parseOne(text);
    return { ok: true, doc: { kind: 'json', root: value, hasBigInts: big } };
  } catch (e) {
    if (looksLikeNdjson(text)) {
      return { ok: true, doc: parseNdjson(text) };
    }
    return { ok: false, error: describeError(text, e) };
  }
}

/**
 * NDJSON heuristic for text that is not a single JSON document: among the
 * first 20 non-empty lines at least two parse on their own and at least 75%
 * do (so one broken log line does not disqualify the file).
 */
export function looksLikeNdjson(text: string): boolean {
  let checked = 0;
  let good = 0;
  let start = 0;
  while (start < text.length && checked < 20) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;
    checked++;
    try {
      JSON.parse(line);
      good++;
    } catch {
      // counted as a bad line
    }
  }
  return good >= 2 && good / checked >= 0.75;
}

export function parseNdjson(text: string): ParsedDoc {
  const items: unknown[] = [];
  const lines: number[] = [];
  const errors = new Map<number, NdError>();
  let hasBigInts = false;
  let lineNo = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    lineNo++;
    const raw = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (raw.trim() === '') {
      if (end === text.length) break;
      continue;
    }
    try {
      const { value, big } = parseOne(raw);
      if (big) hasBigInts = true;
      items.push(value);
    } catch (e) {
      errors.set(items.length, { message: describeError(raw, e).message, raw });
      items.push(null);
    }
    lines.push(lineNo);
    if (end === text.length) break;
  }
  return { kind: 'ndjson', root: items, hasBigInts, lines, errors };
}

/** Build a LoadError with line/column from a JSON.parse exception. */
export function describeError(text: string, e: unknown): LoadError {
  const msg = e instanceof Error ? e.message : String(e);
  let offset = -1;
  const m = /position (\d+)/.exec(msg);
  if (m) offset = Number(m[1]);
  if (offset < 0) offset = findErrorOffset(text);
  if (offset < 0) offset = 0;
  const { line, column } = lineCol(text, offset);
  const clean = msg.replace(/^JSON\.parse: /, '');
  return { message: clean, line, column, offset };
}

export function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: end - last };
}

/**
 * Minimal JSON scanner that returns the offset of the first syntax error, or -1.
 * Only used to locate errors when the engine's message has no position.
 */
export function findErrorOffset(s: string): number {
  let i = 0;
  const n = s.length;
  const ws = () => {
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  // Explicit stack: 'o' object, 'a' array. State machine avoids recursion limits.
  const stack: string[] = [];
  type Expect = 'value' | 'key' | 'colon' | 'commaOrEnd';
  let expect: Expect = 'value';
  for (;;) {
    ws();
    if (i >= n) return stack.length || expect === 'value' ? i : -1;
    const c = s[i];
    if (expect === 'value' || expect === 'key') {
      if (expect === 'key') {
        if (c === '}' && s[i - 1] !== ',' && prevNonWs(s, i) === '{') {
          i++;
          stack.pop();
          expect = 'commaOrEnd';
          if (!stack.length) return trailing();
          continue;
        }
        if (c !== '"') return i;
        if (!str()) return i;
        expect = 'colon';
        continue;
      }
      if (c === '{') {
        stack.push('o');
        i++;
        expect = 'key';
        continue;
      }
      if (c === '[') {
        stack.push('a');
        i++;
        ws();
        if (s[i] === ']') {
          i++;
          stack.pop();
          expect = 'commaOrEnd';
          if (!stack.length) return trailing();
        }
        continue;
      }
      if (c === '"') {
        if (!str()) return i;
      } else if (c === '-' || (c >= '0' && c <= '9')) {
        if (!num()) return i;
      } else if (s.startsWith('true', i)) i += 4;
      else if (s.startsWith('false', i)) i += 5;
      else if (s.startsWith('null', i)) i += 4;
      else return i;
      expect = 'commaOrEnd';
      if (!stack.length) return trailing();
      continue;
    }
    if (expect === 'colon') {
      if (c !== ':') return i;
      i++;
      expect = 'value';
      continue;
    }
    // commaOrEnd
    const top = stack[stack.length - 1];
    if (c === ',') {
      i++;
      expect = top === 'o' ? 'key' : 'value';
      continue;
    }
    if ((c === '}' && top === 'o') || (c === ']' && top === 'a')) {
      i++;
      stack.pop();
      if (!stack.length) return trailing();
      continue;
    }
    return i;
  }

  function trailing(): number {
    ws();
    return i < n ? i : -1;
  }
  function str(): boolean {
    i++; // opening quote
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 34) {
        i++;
        return true;
      }
      if (c === 92) {
        i += 2;
        continue;
      }
      if (c < 32) return false;
      i++;
    }
    return false;
  }
  function num(): boolean {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 400));
    if (!m) return false;
    i += m[0].length;
    return true;
  }
}

function prevNonWs(s: string, i: number): string {
  let j = i - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  return s[j];
}
