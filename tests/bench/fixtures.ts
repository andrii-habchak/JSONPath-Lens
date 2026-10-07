/** Deterministic large payload generator (≈ `targetMb` MB of JSON). */
export function makeLargeJson(targetMb: number): string {
  const items: unknown[] = [];
  const statuses = ['ACTIVE', 'FAILED', 'PENDING', 'DONE'];
  let size = 0;
  let i = 0;
  const target = targetMb * 1024 * 1024;
  while (size < target) {
    const item = {
      id: 10_000_000_000_000_000 + i * 7919,
      name: `player-${i}`,
      email: `user${i}@${i % 3 ? 'corp.io' : 'gmail.com'}`,
      status: statuses[i % 4],
      balance: { amount: (i * 13.37) % 10_000, currency: i % 2 ? 'EUR' : 'USD' },
      tags: ['t' + (i % 10), 't' + (i % 7)],
      meta: { createdAt: '2026-10-07T12:00:00Z', flags: { vip: i % 50 === 0, test: false } },
    };
    items.push(item);
    size += JSON.stringify(item).length + 1;
    i++;
  }
  return JSON.stringify({ total: items.length, items });
}
