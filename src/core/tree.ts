import type { DocIndex } from './index';

/** Expand/collapse state and the flattened list of visible node ids. */
export class TreeState {
  expanded: Uint8Array;
  visible: Int32Array;
  visibleCount = 0;
  /** Node id → visible row index, or -1. */
  rowOf: Int32Array;
  private stack: Int32Array;

  constructor(private index: DocIndex) {
    this.expanded = new Uint8Array(index.count);
    this.visible = new Int32Array(Math.min(index.count, 4096));
    this.rowOf = new Int32Array(index.count).fill(-1);
    this.stack = new Int32Array(64);
  }

  /** Default view: everything for small docs, the first two levels otherwise. */
  applyDefault(smallLimit = 3000, depthLimit = 2): void {
    const { index } = this;
    const all = index.count <= smallLimit;
    for (let id = 0; id < index.count; id++) {
      if (index.isContainer(id) && (all || index.depth[id] < depthLimit)) this.expanded[id] = 1;
    }
    // Huge NDJSON: keep lines collapsed so the first screen is a list of lines.
    if (index.isNdjson && !all) {
      const f = index.first[0];
      for (let i = 0; i < index.size[0]; i++) this.expanded[f + i] = 0;
    }
    this.expanded[0] = 1;
    this.recompute();
  }

  recompute(): void {
    const { index } = this;
    const prev = this.visibleCount;
    for (let i = 0; i < prev; i++) this.rowOf[this.visible[i]] = -1;
    let n = 0;
    let sp = 0;
    this.push(sp++, 0);
    while (sp > 0) {
      const id = this.stack[--sp];
      if (n >= this.visible.length) this.visible = grow(this.visible, n + 1);
      this.visible[n] = id;
      this.rowOf[id] = n;
      n++;
      if (this.expanded[id] && index.isContainer(id)) {
        const first = index.first[id];
        for (let c = first + index.size[id] - 1; c >= first; c--) this.push(sp++, c);
      }
    }
    this.visibleCount = n;
  }

  private push(at: number, id: number): void {
    if (at >= this.stack.length) this.stack = grow(this.stack, at + 1);
    this.stack[at] = id;
  }

  toggle(id: number): void {
    if (!this.index.isContainer(id)) return;
    this.expanded[id] = this.expanded[id] ? 0 : 1;
    this.recompute();
  }

  setExpanded(id: number, open: boolean, recursive = false): void {
    const { index } = this;
    if (!index.isContainer(id)) return;
    if (!recursive) {
      this.expanded[id] = open ? 1 : 0;
    } else {
      // Children of a container are contiguous; walk the subtree breadth-first.
      const queue = [id];
      for (let q = 0; q < queue.length; q++) {
        const n = queue[q];
        if (!index.isContainer(n)) continue;
        this.expanded[n] = open ? 1 : 0;
        const f = index.first[n];
        for (let c = f; c < f + index.size[n]; c++) if (index.isContainer(c)) queue.push(c);
      }
    }
    if (id === 0 && !open && !recursive) this.expanded[0] = 0;
    this.recompute();
  }

  expandAll(): void {
    const { index } = this;
    for (let id = 0; id < index.count; id++) if (index.isContainer(id)) this.expanded[id] = 1;
    this.recompute();
  }

  collapseAll(): void {
    this.expanded.fill(0);
    this.expanded[0] = 1;
    this.recompute();
  }

  /** Open every ancestor of the given ids (no recompute). */
  openAncestors(ids: Iterable<number>): void {
    const { parent } = this.index;
    for (const id of ids) {
      let p = parent[id];
      while (p >= 0) {
        this.expanded[p] = 1;
        p = parent[p];
      }
    }
  }

  /** Make a node visible and return its row index. */
  reveal(id: number): number {
    if (this.rowOf[id] >= 0) return this.rowOf[id];
    this.openAncestors([id]);
    this.recompute();
    return this.rowOf[id];
  }
}

function grow(a: Int32Array, need: number): Int32Array {
  let cap = Math.max(16, a.length);
  while (cap < need) cap *= 2;
  const b = new Int32Array(cap);
  b.set(a);
  return b;
}
