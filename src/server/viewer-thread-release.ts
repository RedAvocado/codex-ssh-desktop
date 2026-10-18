// A browser window and an app-server subscription have different lifetimes.
// Destroying the former does not release the latter's on-disk writer lock.
export type ViewerThreadClient = {
  sendAppServerRequest(method: string, params: unknown, assertCurrent?: () => void): Promise<any>;
  readThread(id: string, options: {includeTurns: false}): Promise<{status?: {type?: string}} | null>;
  getPendingRequestCount(): number;
  registerInternalNotificationHandler(handler: (event: {method: string}) => void): () => void;
};

type View = {connected: boolean; parked: boolean};

export class ViewerThreadRelease {
  private client?: ViewerThreadClient;
  private removeListener?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private disposed = false;
  private released = new Set<string>();
  private observed = {loaded: 0, active: 0, released: 0, errors: 0};

  constructor(private views: () => View[], private retireInactiveViews: () => void) {}

  attach(client: ViewerThreadClient) {
    this.removeListener?.();
    this.client = client;
    this.removeListener = client.registerInternalNotificationHandler(event => {
      if (['thread/started', 'thread/status/changed', 'turn/completed'].includes(event.method)) this.changed();
    });
    this.changed();
  }

  snapshot() { return {...this.observed}; }

  // Brief network drops retain their renderer. An explicit background signal
  // can hand idle chats back promptly; a dropped socket gets reconnect grace.
  changed() {
    if (this.disposed) return;
    clearTimeout(this.timer);
    const views = this.views();
    if (views.some(view => view.connected && !view.parked)) { this.released.clear(); return; }
    this.timer = setTimeout(() => { void this.sweep(); }, views.some(view => !view.connected && !view.parked) ? 15_000 : 1_000);
    this.timer.unref();
  }

  sweep(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.releaseIdle().catch(() => {
      this.observed.errors++;
      console.warn('[viewer-ownership] Idle chat release failed; will retry');
    }).finally(() => {
      this.running = undefined;
      if (!this.disposed && !this.views().some(view => view.connected && !view.parked)) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.sweep(); }, 5_000);
        this.timer.unref();
      }
    });
    return this.running;
  }

  private async releaseIdle() {
    const client = this.client;
    const available = () => !this.disposed && this.client === client &&
      !this.views().some(view => view.connected && !view.parked);
    if (!client || !available() || client.getPendingRequestCount() > 0) return;
    // Read only this auxiliary engine's loaded threads, never the native app's.
    const ids = new Set<string>();
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      if (!available()) return;
      const page = await client.sendAppServerRequest('thread/loaded/list', {cursor, limit: 100});
      if (!Array.isArray(page.data) || !page.data.every((id: unknown) => typeof id === 'string')) throw Error('Invalid loaded threads');
      for (const id of page.data) ids.add(id);
      cursor = page.nextCursor ?? null;
      if (cursor && cursors.has(cursor)) throw Error('Repeated loaded threads cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    this.observed.loaded = ids.size;
    this.observed.active = 0;
    for (const id of this.released) if (!ids.has(id)) this.released.delete(id);
    for (const id of ids) {
      if (!available() || client.getPendingRequestCount() > 0) return;
      if (this.released.has(id)) continue;
      const thread = await client.readThread(id, {includeTurns: false});
      // Unknown, running, approval, and user-input states all stay loaded.
      if (thread?.status?.type !== 'idle') { this.observed.active++; continue; }
      if (!available() || client.getPendingRequestCount() > 0) return;
      // A retained renderer cannot keep its old owner role after we unsubscribe
      // on its behalf. End only background views; existing draft recovery still
      // prevents automatic reload when unsent work is present.
      this.retireInactiveViews();
      await client.sendAppServerRequest('thread/unsubscribe', {threadId: id}, () => {
        if (!available() || client.getPendingRequestCount() > 0) throw Error('Viewer became active');
      });
      this.released.add(id);
      this.observed.released++;
      console.info('[viewer-ownership] Released an idle chat from the auxiliary engine');
    }
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.removeListener?.();
  }
}
