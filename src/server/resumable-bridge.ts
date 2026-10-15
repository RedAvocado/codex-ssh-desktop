import {WebSocket, WebSocketServer} from 'ws';
import {ReliableChannel} from '../shared/reliable-channel';

// Retain the registered view and its MessagePorts through short iOS suspensions.
// This identifier is only continuity state: normal token/origin authorization is
// still required before WebSocket upgrade. Nothing survives a server restart.
export function resumableBridge<T>(server: WebSocketServer, create: (
  send: (message: T) => void,
  fail: (reason: string) => void,
) => {receive: (message: T) => void; dispose: () => void}, ttl = 2 * 60_000) {
  type Session = {
    channel: ReliableChannel<T>;
    socket?: WebSocket;
    timer?: NodeJS.Timeout;
    idleDeadline?: number;
    dispose: () => void;
    clientId?: string;
    detachedAt?: number;
    parked: boolean;
  };
  const sessions = new Map<string, Session>();
  const remove = (id: string) => {
    const session = sessions.get(id); if (!session) return;
    sessions.delete(id); clearTimeout(session.timer);
    session.socket?.close(1000, 'View expired'); session.channel.detach();
    try { session.dispose(); } catch { console.error('[ipc-bridge] view cleanup failed'); }
  };
  const expireAfterIdle = (id: string, session: Session) => {
    clearTimeout(session.timer);
    // A later socket close or duplicate park must not restart the grace period
    // and keep an abandoned renderer holding a writer indefinitely.
    session.idleDeadline ??= Date.now() + ttl;
    session.timer = setTimeout(() => {
      if (sessions.get(id) === session) remove(id);
    }, Math.max(0, session.idleDeadline - Date.now()));
    session.timer.unref();
  };
  server.on('connection', socket => {
    let id: string | undefined;
    let alive = true;
    const helloDeadline = setTimeout(() => socket.close(1008, 'Missing handshake'), 10_000);
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false; socket.ping();
    }, 25_000);
    socket.on('pong', () => {alive = true;});
    socket.on('error', () => socket.terminate());
    socket.on('message', raw => {
      let frame: any; try { frame = JSON.parse(String(raw)); } catch { socket.close(1008); return; }
      if (!id) {
        if (frame?.type !== 'bridge-hello' || !/^[a-f0-9-]{36}$/.test(frame.sessionId) ||
          typeof frame.resume !== 'boolean' || !Number.isSafeInteger(frame.ack) || frame.ack < 0 ||
          (frame.clientId !== undefined && (typeof frame.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(frame.clientId)))) {
          socket.close(1008, 'Invalid handshake'); return;
        }
        const sessionId: string = frame.sessionId;
        const clientId: string | undefined = frame.clientId;
        let session = sessions.get(sessionId);
        if (!session && !frame.resume && frame.ack === 0) {
          // iOS may discard a Home Screen page without delivering pagehide or
          // its bridge-release. A fresh page from that tab supersedes its
          // disconnected or parked predecessor. An active foreground view may
          // belong to a duplicated tab, so keep it independent.
          if (clientId) for (const [oldId, old] of sessions) {
            if (old.clientId === clientId && (old.parked || old.socket?.readyState !== WebSocket.OPEN)) remove(oldId);
          }
          // If sessionStorage was also lost, keep the server usable: reclaim
          // the oldest detached view before rejecting a new authorized page.
          if (sessions.size >= 16) {
            let oldestId: string | undefined;
            let oldestAt = Infinity;
            for (const [oldId, old] of sessions) {
              if (old.socket?.readyState === WebSocket.OPEN) continue;
              const at = old.detachedAt ?? 0;
              if (at < oldestAt) { oldestId = oldId; oldestAt = at; }
            }
            if (oldestId) remove(oldestId);
          }
        }
        // The server may have created the view just before the connection lost
        // its welcome. Until any client frame is accepted, an initial hello is
        // safe to repeat; the client has not yet attached its outgoing queue.
        const repeatedInitialHello = session && !frame.resume && frame.ack === 0 && session.channel.received === 0;
        if ((!session && frame.resume) || (session && !frame.resume && !repeatedInitialHello) || (!session && frame.ack !== 0) ||
          (!session && sessions.size >= 16)) {
          socket.send(JSON.stringify({type:'bridge-reset'})); socket.close(1000); return;
        }
        if (!session) {
          let view: ReturnType<typeof create> | undefined;
          const channel = new ReliableChannel<T>(message => view?.receive(message), reason => {
            console.warn('[ipc-bridge] session reset:',reason);
            const current = sessions.get(sessionId);
            if (current?.socket?.readyState === WebSocket.OPEN) current.socket.send(JSON.stringify({type:'bridge-reset'}));
            remove(sessionId);
          });
          // Register before invoking the factory: startup can synchronously send
          // enough data to overflow, or fail before returning a view.
          session = {channel, socket, dispose:()=>view?.dispose(), clientId, parked:false}; sessions.set(sessionId, session);
          try { view = create(message => channel.send(message), reason => channel.abort(reason)); }
          catch { channel.abort('renderer initialization failed'); }
          if (channel.failed) {
            // A synchronous failure happened before the view could be returned
            // to remove(). Dispose its eventual return value exactly once.
            try { view?.dispose(); } catch { console.error('[ipc-bridge] view cleanup failed'); }
            return;
          }
        }
        id = sessionId; clearTimeout(helloDeadline); clearTimeout(session.timer); session.timer = undefined; session.idleDeadline = undefined;
        const previous = session.socket; session.socket = socket; session.detachedAt = undefined; session.parked = false;
        if (previous !== socket) previous?.close(1000, 'Connection replaced');
        socket.send(JSON.stringify({type:'bridge-welcome', ack:session.channel.received}));
        session.channel.attach(wire => {if(socket.readyState === WebSocket.OPEN) socket.send(wire);}, frame.ack);
        return;
      }
      const session = sessions.get(id);
      if (session?.socket === socket) {
        if (frame?.type === 'bridge-release') { remove(id); return; }
        if (frame?.type === 'bridge-probe') {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'bridge-probe-ack'}));
          return;
        }
        if (frame?.type === 'bridge-park') { session.parked = true; expireAfterIdle(id, session); return; }
        if (frame?.type === 'bridge-unpark') {
          session.parked = false; clearTimeout(session.timer); session.timer = undefined; session.idleDeadline = undefined; return;
        }
        try { session.channel.receive(frame); }
        catch { session.channel.abort('renderer dispatch failed'); }
      }
    });
    socket.on('close', () => {
      clearTimeout(helloDeadline); clearInterval(heartbeat);
      const session = id ? sessions.get(id) : undefined;
      if (session?.socket === socket) {
        session.socket = undefined; session.detachedAt = Date.now(); session.channel.detach();
        expireAfterIdle(id!, session);
      }
    });
  });
  server.on('close', () => { for (const id of sessions.keys()) remove(id); });
  return () => [...sessions.values()].map(s => ({...s.channel.snapshot(),connected:s.socket?.readyState===WebSocket.OPEN,parked:s.parked}));
}
