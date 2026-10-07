import { signal, type Signal } from '@preact/signals';

export interface HistoryEntry {
  query: string;
  /** 'jsonpath' | 'text' | 'regex' */
  mode: string;
  /** Match count when it last ran. */
  count: number;
  at: number;
}

export const HISTORY_LIMIT = 50;

/**
 * In-memory query history. One store per tab / document / DevTools request.
 * Nothing is persisted: a reload starts empty.
 */
export class QueryHistory {
  readonly entries: Signal<HistoryEntry[]> = signal([]);

  add(query: string, mode: string, count: number): void {
    const q = query.trim();
    if (!q) return;
    const rest = this.entries.value.filter((e) => !(e.query === q && e.mode === mode));
    this.entries.value = [{ query: q, mode, count, at: Date.now() }, ...rest].slice(0, HISTORY_LIMIT);
  }

  remove(index: number): void {
    const next = this.entries.value.slice();
    next.splice(index, 1);
    this.entries.value = next;
  }

  clear(): void {
    this.entries.value = [];
  }
}
