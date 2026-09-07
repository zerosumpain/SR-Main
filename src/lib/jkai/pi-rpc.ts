/** Small transport boundary: Pi owns the agent loop; SR owns delivery policy. */
export interface WorkerCapabilities {
  engine: 'pi';
  persistentSessions: true;
  steering: true;
  interruption: true;
}
export const PI_CAPABILITIES: WorkerCapabilities = {
  engine: 'pi', persistentSessions: true, steering: true, interruption: true,
};

export type RpcEvent = { type: string; id?: string; success?: boolean; error?: string; [key: string]: unknown };

/** Split only on LF: Unicode line separators are legal inside JSON strings. */
export class JsonLines {
  private tail = '';
  push(chunk: string): RpcEvent[] {
    this.tail += chunk;
    if (this.tail.length > 16 * 1024 * 1024) throw new Error('Pi RPC record exceeded 16 MiB');
    const lines = this.tail.split('\n');
    this.tail = lines.pop()!;
    return lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as RpcEvent);
  }
}

export class PiRpc {
  private sequence = 0;
  private pending = new Map<string, { resolve: (e: RpcEvent) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  constructor(private write: (line: string) => void, private timeoutMs = 30_000) {}
  request(type: string, args: Record<string, unknown> = {}): Promise<RpcEvent> {
    if (this.closed) return Promise.reject(new Error('Pi session disconnected'));
    const id = `sr-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi did not acknowledge ${type}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write(`${JSON.stringify({ ...args, type, id })}\n`); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  receive(event: RpcEvent): boolean {
    if (event.type !== 'response' || !event.id) return false;
    const pending = this.pending.get(event.id);
    if (!pending) return true;
    clearTimeout(pending.timer);
    this.pending.delete(event.id);
    if (event.success) pending.resolve(event);
    else pending.reject(new Error(event.error || 'Pi rejected the request'));
    return true;
  }
  respond(id: string, value: string): void {
    if (this.closed) throw new Error('Pi session disconnected');
    this.write(`${JSON.stringify({ type: 'extension_ui_response', id, value })}\n`);
  }
  close(): void {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Pi session disconnected')); }
    this.pending.clear();
  }
}

export function instructionEnvelope(id: number, content: string): string {
  return `[sr-instruction:${id}]\n${content}`;
}
export function instructionIds(text: string): number[] {
  return [...text.matchAll(/\[sr-instruction:(\d+)\]/g)].map((m) => Number(m[1]));
}

const workers = new Map<string, PiRpc>();
export function registerPiWorker(buildId: string, rpc: PiRpc): () => void {
  workers.set(buildId, rpc);
  return () => { if (workers.get(buildId) === rpc) workers.delete(buildId); };
}
export function activePiWorker(buildId: string): PiRpc | undefined { return workers.get(buildId); }
