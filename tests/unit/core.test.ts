import { describe, expect, it } from 'vitest';
import { JsonDocument } from '../../src/core/document';
import { cleanText, findErrorOffset, looksLikeNdjson, parseDocument } from '../../src/core/parse';
import { quoteName } from '../../src/core/path';
import { rewriteRegexSugar, runJsonPath } from '../../src/core/query';

function load(text: string, contentType?: string): JsonDocument {
  const r = JsonDocument.load(text, contentType);
  if (!r.ok) throw new Error(`load failed: ${r.error.message}`);
  return r.doc;
}

const SAMPLE = {
  array: [
    { key: 1, dictionary: { a: 'x' } },
    { key: 2, dictionary: { a: 'yes' } },
  ],
  users: [
    { name: 'Andrii', email: 'a@gmail.com', id: 1 },
    { name: 'bob', email: 'bob@corp.io', id: 2 },
  ],
  items: [
    { price: 20, tags: ['sale'], id: 3 },
    { price: 5, tags: ['sale'] },
    { price: 30, tags: ['new'] },
  ],
  'odd key': { "it's": true },
};

describe('parse', () => {
  it('strips BOM and XSSI prefixes', () => {
    expect(cleanText('﻿{"a":1}')).toBe('{"a":1}');
    expect(cleanText(")]}',\n{\"a\":1}")).toBe('{"a":1}');
    expect(cleanText('while(1);[1]')).toBe('[1]');
  });

  it('keeps exact digits of unsafe integers', () => {
    const doc = load('{"id": 12345678901234567890, "n": [9007199254740993], "ok": 5}');
    expect(doc.info.bigInts).toBe(true);
    expect(doc.valueText(0, false)).toBe('{"id":12345678901234567890,"n":[9007199254740993],"ok":5}');
    const r = doc.query('$.id');
    expect(r.results[0].preview).toBe('12345678901234567890');
  });

  it('reports line and column of a syntax error', () => {
    const r = JsonDocument.load('{\n  "a": 1,\n  "b": }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(3);
      expect(r.error.column).toBe(8);
    }
  });

  it('finds error offsets with the fallback scanner', () => {
    expect(findErrorOffset('{"a":1}')).toBe(-1);
    expect(findErrorOffset('{"a":1,}')).toBe(7);
    expect(findErrorOffset('[1, 2')).toBe(5);
    expect(findErrorOffset('{"a" 1}')).toBe(5);
    expect(findErrorOffset('[1] x')).toBe(4);
  });
});

describe('ndjson', () => {
  const nd = '{"level":"INFO","service":"wallet"}\n\n{"level":"ERROR","service":"wallet","id":1}\nnot json\n{"level":"ERROR","service":"bonus"}\n';

  it('detects by heuristic and keeps bad lines', () => {
    expect(looksLikeNdjson(nd)).toBe(true); // 3 of 4 lines parse
    expect(looksLikeNdjson('{"a":1}\n{"a":2}\n')).toBe(true);
    expect(looksLikeNdjson('{\n  "a": 1,\n  "b": }')).toBe(false); // broken pretty JSON
    expect(looksLikeNdjson('{"a":1}\nnope\nnope')).toBe(false);
    const doc = load(nd, 'application/x-ndjson');
    expect(doc.info.kind).toBe('ndjson');
    expect(doc.info.badLines).toBe(1);
    const rows = doc.rows(0, 10);
    expect(rows[0].type).toBe('array');
    const lines = rows.filter((r) => r.depth === 1);
    expect(lines.map((r) => r.line)).toEqual([1, 3, 4, 5]);
    expect(lines[2].type).toBe('error');
    expect(lines[2].error).toBeTruthy();
  });

  it('auto-detects NDJSON without content type', () => {
    const doc = load('{"a":1}\n{"a":2}\n{"a":3}');
    expect(doc.info.kind).toBe('ndjson');
    expect(doc.query('$[?@.a > 1]').total).toBe(2);
  });

  it('queries across lines', () => {
    const doc = load(nd, 'application/x-ndjson');
    const r = doc.query("$[?@.level=='ERROR' && @.service=='wallet']");
    expect(r.total).toBe(1);
    expect(r.results[0].path).toBe('$[1]');
    expect(r.results[0].line).toBe(3);
  });

  it('serializes back to one value per line', () => {
    const doc = load('{"a":1}\n{"b":[1,2]}\n');
    expect(doc.text('pretty')).toBe('{"a":1}\n{"b":[1,2]}\n');
  });
});

describe('jsonpath', () => {
  const doc = load(JSON.stringify(SAMPLE));

  it('runs the example from the plan', () => {
    const r = doc.query('$.array[?(@.key==2)].dictionary.a');
    expect(r.mode).toBe('jsonpath');
    expect(r.total).toBe(1);
    expect(r.results[0].path).toBe('$.array[1].dictionary.a');
    expect(r.results[0].preview).toBe('"yes"');
  });

  it('supports standard search() and match()', () => {
    expect(doc.query("$..[?search(@.email, 'gmail')]").total).toBe(1);
    expect(doc.query("$.users[?match(@.name, 'bob')]").total).toBe(1);
  });

  it('supports =~ regex sugar with flags', () => {
    const r = doc.query('$.users[?@.name =~ /^and/i]');
    expect(r.error).toBeUndefined();
    expect(r.total).toBe(1);
    expect(r.rewritten).toBe("$.users[?regex(@.name, '^and', 'i')]");
    expect(doc.query('$.users[?@.name =~ /^and/]').total).toBe(0);
  });

  it('handles nested filters, recursive descent and wildcards', () => {
    expect(doc.query("$.items[?@.price > 10 && @.tags[?@ == 'sale']]").total).toBe(1);
    expect(doc.query('$..id').total).toBe(3);
    expect(doc.query('$.items[*].price').total).toBe(3);
    expect(doc.query('$.items[-1:]').total).toBe(1);
  });

  it('reports syntax errors with a position', () => {
    const r = doc.query('$.a[?@.x ==]');
    expect(r.total).toBe(0);
    expect(r.error?.message).toBeTruthy();
    expect(r.error?.position).toBe(11);
  });

  it('builds bracket paths for awkward names', () => {
    const r = doc.query("$['odd key'][\"it's\"]");
    expect(r.total).toBe(1);
    expect(r.results[0].path).toBe("$['odd key']['it\\'s']");
    expect(quoteName('a\nb')).toBe("'a\\nb'");
  });

  it('auto-expands ancestors of matches and highlights them', () => {
    const d = load(JSON.stringify({ deep: { deeper: { deepest: { target: 1 } } }, pad: Array(5000).fill(0) }));
    const before = d.rowOf(d.query('$.deep.deeper.deepest.target').results[0].id);
    expect(before).toBeGreaterThan(0);
    const row = d.rows(before, 1)[0];
    expect(row.match).toBe(true);
    expect(row.key).toBe('target');
  });
});

describe('regex sugar rewrite', () => {
  it('escapes backslashes, quotes and slashes', () => {
    expect(rewriteRegexSugar("$[?@.a =~ /\\d+'x\\/y/]").query).toBe("$[?regex(@.a, '\\\\d+\\'x/y', '')]");
    const out = runJsonPath('$[?@.a =~ /\\d{3}/]', [{ a: 'x123' }, { a: 'x12' }]);
    expect(out.locations).toEqual([[0]]);
  });

  it('supports bracketed operands and negation', () => {
    const data = [{ 'my key': 'Hello' }, { 'my key': 'bye' }];
    expect(runJsonPath("$[?@['my key'] =~ /^h/i]", data).locations).toEqual([[0]]);
    expect(runJsonPath("$[?!(@['my key'] =~ /^h/i)]", data).locations).toEqual([[1]]);
  });
});

describe('quick search', () => {
  const doc = load(JSON.stringify(SAMPLE));

  it('matches keys and values, case-insensitive by default', () => {
    expect(doc.query('andrii').total).toBe(1);
    expect(doc.query('EMAIL', { scope: 'keys' }).total).toBe(2);
    expect(doc.query('EMAIL', { scope: 'values' }).total).toBe(0);
    expect(doc.query('Andrii', { caseSensitive: true }).total).toBe(1);
    expect(doc.query('andrii', { caseSensitive: true }).total).toBe(0);
  });

  it('supports regex mode and reports bad patterns', () => {
    expect(doc.query('^\\w+@gmail\\.com$', { regex: true }).total).toBe(1);
    expect(doc.query('(', { regex: true }).error).toBeTruthy();
  });

  it('caps result list but keeps total exact', () => {
    const big = load(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ v: 'hit' + i }))));
    const r = big.query('hit', { limit: 10 });
    expect(r.total).toBe(50);
    expect(r.results.length).toBe(10);
  });
});

describe('tree', () => {
  it('expands everything for small docs and toggles', () => {
    const doc = load(JSON.stringify(SAMPLE));
    const all = doc.visibleCount;
    expect(all).toBe(doc.info.nodeCount);
    const usersRow = doc.rows(0, all).find((r) => r.key === 'users')!;
    const after = doc.toggle(usersRow.id);
    expect(after).toBeLessThan(all);
    expect(doc.collapseAll()).toBe(1 + 4);
    expect(doc.expandAll()).toBe(all);
  });

  it('serializes subtrees and documents', () => {
    const doc = load('{"a":[1,{"b":null}],"c":"x"}');
    expect(doc.valueText(0, false)).toBe('{"a":[1,{"b":null}],"c":"x"}');
    expect(doc.text('pretty')).toBe('{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ],\n  "c": "x"\n}');
    expect(parseDocument('[]').ok).toBe(true);
    expect(load('[]').text('pretty')).toBe('[]');
  });

  it('returns matched values as a JSON array', () => {
    const doc = load('{"a":[{"x":1},{"x":2}]}');
    doc.query('$.a[*].x');
    expect(JSON.parse(doc.resultsText())).toEqual([1, 2]);
  });
});

describe('serializer paths agree', () => {
  it('native and iterative serializers produce identical text', async () => {
    const { serializeIterative, serialize } = await import('../../src/core/serialize');
    const text = '{"a":[1,{"b":null,"c":"x\\"y"}],"big":12345678901234567890,"arr":[98765432109876543210,1.5e300],"e":{},"f":[]}';
    const doc = load(text);
    for (const indent of [0, 2]) {
      expect(serialize(doc.index, 0, indent)).toBe(serializeIterative(doc.index, 0, indent));
    }
    expect(serialize(doc.index, 0, 0)).toBe('{"a":[1,{"b":null,"c":"x\\"y"}],"big":12345678901234567890,"arr":[98765432109876543210,1.5e+300],"e":{},"f":[]}');
  });

  it('does not touch digits inside strings or floats', () => {
    const doc = load('{"s":"12345678901234567890","f":1234567890123456789.5,"n":-12345678901234567890}');
    expect(doc.valueText(0, false)).toBe('{"s":"12345678901234567890","f":1234567890123456800,"n":-12345678901234567890}');
    expect(doc.query('$.s').results[0].type).toBe('string');
    expect(doc.query('$.n').results[0].type).toBe('number');
  });

  it('handles a top-level big integer', () => {
    const doc = load('12345678901234567890');
    expect(doc.text('pretty')).toBe('12345678901234567890');
    expect(doc.info.rootType).toBe('number');
  });
});
