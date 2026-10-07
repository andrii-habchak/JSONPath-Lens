/// <reference types="node" />
// Performance check for the core engine on generated 50 MB and 100 MB payloads.
// Run: pnpm bench
import { JsonDocument } from '../src/core/document.ts';
import { makeLargeJson } from '../tests/bench/fixtures.ts';
for (const mb of [50, 100]) {
  const text = makeLargeJson(mb);
  let t = performance.now();
  const r = JsonDocument.load(text);
  if (!r.ok) throw new Error();
  const d = r.doc;
  console.log(
    mb,
    'MB',
    (text.length / 1e6).toFixed(1),
    'Mchars',
    d.info,
    'total',
    Math.round(performance.now() - t),
    'ms',
    'heap',
    Math.round(process.memoryUsage().heapUsed / 1e6),
    'MB',
  );
  for (const q of [
    "$.items[?@.status == 'FAILED' && @.balance.amount > 5000].email",
    '$.items[?@.email =~ /gmail\\.com$/i].id',
    'player-12345',
    '$..vip',
  ]) {
    t = performance.now();
    const res = d.query(q);
    console.log(' ', q, res.total, Math.round(performance.now() - t), 'ms', res.error?.message ?? '');
  }
  t = performance.now();
  const n = d.expandAll();
  console.log('  expandAll', n, Math.round(performance.now() - t), 'ms');
  t = performance.now();
  d.rows(n / 2, 60);
  console.log('  rows', (performance.now() - t).toFixed(2), 'ms');
  t = performance.now();
  const s = d.text('pretty');
  console.log('  pretty', s.length, Math.round(performance.now() - t), 'ms');
}
