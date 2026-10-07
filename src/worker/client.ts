import type { Method, Request, Response, WorkerApi } from './protocol';

type Result<M extends Method> = ReturnType<WorkerApi[M]>;

/** Promise-based client for the JSON worker. */
export class WorkerClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      const p = this.pending.get(e.data.seq);
      if (!p) return;
      this.pending.delete(e.data.seq);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Worker error');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  call<M extends Method>(method: M, ...args: Parameters<WorkerApi[M]>): Promise<Result<M>> {
    const seq = ++this.seq;
    const transfer: Transferable[] = [];
    if (method === 'load' && args[0] instanceof ArrayBuffer) transfer.push(args[0]);
    const msg: Request<M> = { seq, method, args };
    return new Promise<Result<M>>((resolve, reject) => {
      this.pending.set(seq, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  terminate(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Worker terminated'));
    this.pending.clear();
  }
}
