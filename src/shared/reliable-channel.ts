// Sequence/acknowledgement numbers survive a WebSocket replacement. Requests
// acknowledged by the receiver are never dispatched again after reconnecting.
export class ReliableChannel<T> {
  received = 0;
  private sent = 0;
  private written = 0;
  private flushing = false;
  private bytes = 0;
  private pending = new Map<number, string>();
  private write: ((wire: string) => void) | undefined;
  failed = false;
  snapshot() { return {sent:this.sent,written:this.written,received:this.received,pending:this.pending.size,bytes:this.bytes,failed:this.failed,nextQueued:this.pending.has(this.written+1)}; }
  constructor(private deliver: (payload: T) => void, private fail: (reason: string) => void,
    private limit = 32 * 1024 * 1024) {}
  attach(write: (wire: string) => void, ack: number): void {
    if (this.failed || !this.acknowledge(ack)) return;
    this.write = write;
    this.written = ack;
    this.flush();
  }
  detach(): void { this.write = undefined; }
  send(payload: T): void {
    if (this.failed) return;
    const seq = ++this.sent;
    let wire: string;
    try { wire = JSON.stringify({type: 'bridge-data', seq, ack: this.received, payload}); }
    catch { this.abort('message could not be serialized'); return; }
    this.bytes += wire.length * 2;
    this.pending.set(seq, wire);
    if (this.bytes > this.limit || this.pending.size > 4096) { this.abort(`queue capacity (${this.bytes} bytes, ${this.pending.size} messages)`); return; }
    this.flush();
  }
  receive(frame: any): void {
    if (this.failed || !frame || !this.acknowledge(frame.ack)) return;
    if (frame.type === 'bridge-ack') return;
    if (frame.type !== 'bridge-data' || !Number.isSafeInteger(frame.seq) || frame.seq < 1) {
      this.abort('invalid frame'); return;
    }
    if (frame.seq > this.received + 1) { this.abort(`sequence gap (expected ${this.received + 1}, got ${frame.seq})`); return; }
    if (frame.seq === this.received + 1) {
      this.received = frame.seq;
      this.deliver(frame.payload);
    }
    this.write?.(JSON.stringify({type:'bridge-ack', ack:this.received}));
  }
  private acknowledge(ack: number): boolean {
    if (!Number.isSafeInteger(ack) || ack < 0 || ack > this.sent) { this.abort('invalid acknowledgement'); return false; }
    for (const [seq, wire] of this.pending) {
      if (seq > ack) continue;
      this.bytes -= wire.length * 2;
      this.pending.delete(seq);
    }
    return true;
  }
  private flush(): void {
    if (!this.write || this.flushing || this.failed) return;
    this.flushing = true;
    try {
      let wire: string | undefined;
      while ((wire = this.pending.get(this.written + 1)) !== undefined) {
        const writer = this.write; if (!writer) break;
        this.written++;
        writer(wire);
      }
    } finally { this.flushing = false; }
  }
  abort(reason = 'session reset'): void {
    if (this.failed) return;
    this.failed = true; this.pending.clear(); this.bytes = 0; this.detach(); this.fail(reason);
  }
}
