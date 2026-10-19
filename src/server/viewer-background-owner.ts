// Keep the desktop coordination endpoint alive when iOS discards its renderer.
// The existing hosted manager hydrates the SAME engine and streams its normal
// snapshots/patches to native clients. No second engine or turn is started.
export class ViewerBackgroundOwner {
  private binding?: {manager: any; client: any; bindOwner: () => (() => void) | void};
  private cleanup: (() => void)[] = [];
  private adopting = new Set<string>();
  private requests = new Map<unknown, string>();
  private bound = false;

  attach(binding: {manager: any; client: any; bindOwner: () => (() => void) | void}) {
    this.dispose();
    this.binding = binding;
  }

  private owns(id: unknown) {
    return typeof id === 'string' && (this.adopting.has(id) ||
      this.binding?.manager.getStreamRole(id)?.role === 'owner');
  }

  private bind() {
    if (this.bound || !this.binding) return;
    const {manager, client, bindOwner} = this.binding;
    const originalExecution = manager.threadExecution;
    const originalResponse = manager.sendAppServerResponse;
    this.cleanup.push(() => {
      manager.threadExecution = originalExecution;
      manager.sendAppServerResponse = originalResponse;
    });
    try {
    manager.sendAppServerResponse = async (method: string, response: any) => {
      if (this.requests.get(response.id) !== method) return;
      await client.handleClientResponse(response, () => {
        if (this.requests.get(response.id) !== method) return false;
        this.requests.delete(response.id);
        return true;
      });
    };
    // UI-only dynamic tools cannot run after the page has gone. Return a normal
    // tool failure instead of leaving a server request waiting forever. Regular
    // engine/MCP tools and explicit approvals continue through the usual path.
    manager.threadExecution = {executeDynamicToolCall: (request: any) => {
      void manager.sendAppServerResponse(request.method, {id: request.id, result: {
        success: false, contentItems: [{type: 'inputText', text: 'This app tool needs an open viewer. Reopen the viewer before retrying.'}],
      }}).catch(() => console.warn('[viewer-ownership] Background app-tool response failed'));
    }};
    // Hosted managers normally have execution disabled, so their constructor
    // does not attach the coordination broadcasts. Owner discovery alone is
    // insufficient: followers also need snapshots and subsequent patches.
    if (!manager.streamState.attached) {
      manager.streamState.attach();
      this.cleanup.push(() => { manager.streamState.dispose(); manager.streamState.attached = false; });
    }
    const unbindOwner = bindOwner();
    if (typeof unbindOwner === 'function') this.cleanup.push(unbindOwner);
    const activity = manager.registerWindowActivity({canAcquireThreadStream: true, visibilityState: 'hidden'}, () => {});
    this.cleanup.push(() => {
      activity[Symbol.dispose]?.();
    });
    this.cleanup.push(client.registerHostEventHandler({
      onInitialized: () => {
        this.requests.clear();
        manager.markAllConversationsNeedResumeAfterReconnect();
      },
      onNotification: (event: any, capability: any) => {
        const id = event.params?.threadId ?? event.params?.thread?.id;
        if (!this.owns(id)) return;
        if (event.method === 'serverRequest/resolved') this.requests.delete(event.params.requestId);
        manager.onNotification(event.method, event.params, capability);
      },
      onRequest: (request: any) => {
        if (!this.owns(request.params?.threadId)) return false;
        if (!this.requests.has(request.id)) {
          this.requests.set(request.id, request.method);
          manager.onRequest(request);
        }
        return true;
      },
    }));
    this.bound = true;
    } catch (error) {
      for (const cleanup of this.cleanup.splice(0).reverse()) cleanup();
      throw error;
    }
  }

  async adopt(id: string, isCurrent: () => boolean) {
    const binding = this.binding;
    if (!binding) throw Error('Background chat manager is not ready');
    if (!isCurrent()) return;
    this.bind();
    const {manager} = binding;
    if (manager.getStreamRole(id)?.role === 'owner' && manager.getConversation(id)?.resumeState === 'resumed') return;
    this.adopting.add(id);
    try {
      const {thread} = await manager.readThread(id, {includeTurns: false});
      if (!isCurrent() || binding !== this.binding) return;
      const result = await manager.resumeConversation({conversationId: id,
        model: null, reasoningEffort: null, workspaceRoots: [thread.cwd],
      });
      if (result.status !== 'ready' || manager.getStreamRole(id)?.role !== 'owner')
        throw Error('Background chat ownership was not established');
    } catch (error) {
      if (binding === this.binding) this.release(id);
      throw error;
    } finally { this.adopting.delete(id); }
  }

  hasFollowers(id: string) {
    return this.binding?.manager.getStreamRole(id)?.role === 'owner' &&
      this.binding.manager.streamState.hasFollowersOrPendingFollowerReconnect(id) === true;
  }

  release(id: string) {
    const manager = this.binding?.manager;
    if (manager?.getStreamRole(id)?.role !== 'owner') return;
    manager.setConversationStreamRole(id, null);
    manager.updateConversationState(id, (state: any) => { state.resumeState = 'needs_resume'; });
  }

  dispose() {
    for (const cleanup of this.cleanup.splice(0).reverse()) cleanup();
    this.adopting.clear(); this.requests.clear(); this.bound = false;
    this.binding = undefined;
  }
}
