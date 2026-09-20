import {WebSocket, WebSocketServer} from 'ws';
import {ReliableChannel} from '../shared/reliable-channel';

// Retain the registered view and its MessagePorts while iOS suspends networking.
// This identifier is only continuity state: normal token/origin authorization is
// still required before WebSocket upgrade. Nothing survives a server restart.
export function resumableBridge<T>(server: WebSocketServer, create: (
  send: (message: T) => void,
) => {receive: (message: T) => void; dispose: () => void}, ttl = 10 * 60_000) {
  type Session = {channel: ReliableChannel<T>; socket?: WebSocket; timer?: NodeJS.Timeout; dispose: () => void};
  const sessions = new Map<string, Session>();
  const remove = (id: string) => {
    const session = sessions.get(id); if (!session) return;
    sessions.delete(id); clearTimeout(session.timer);
    session.socket?.close(1000, 'View expired'); session.channel.detach(); session.dispose();
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
          typeof frame.resume !== 'boolean' || !Number.isSafeInteger(frame.ack) || frame.ack < 0) {
          socket.close(1008, 'Invalid handshake'); return;
        }
        const sessionId: string = frame.sessionId;
        let session = sessions.get(sessionId);
        // The server may have created the view just before the connection lost
        // its welcome. Until any client frame is accepted, an initial hello is
        // safe to repeat; the client has not yet attached its outgoing queue.
        const repeatedInitialHello = session && !frame.resume && frame.ack === 0 && session.channel.received === 0;
        if ((!session && frame.resume) || (session && !frame.resume && !repeatedInitialHello) || (!session && frame.ack !== 0) ||
          (!session && sessions.size >= 16)) {
          socket.send(JSON.stringify({type:'bridge-reset'})); socket.close(1000); return;
        }
        if (!session) {
          const channel = new ReliableChannel<T>(message => view.receive(message), reason => {
            console.warn('[ipc-bridge] session reset:',reason);
            const current = sessions.get(sessionId);
            current?.socket?.send(JSON.stringify({type:'bridge-reset'})); remove(sessionId);
          });
          const view = create(message => channel.send(message));
          session = {channel, dispose:view.dispose}; sessions.set(sessionId, session);
        }
        id = sessionId; clearTimeout(helloDeadline); clearTimeout(session.timer);
        const previous = session.socket; session.socket = socket;
        previous?.close(1000, 'Connection replaced');
        socket.send(JSON.stringify({type:'bridge-welcome', ack:session.channel.received}));
        session.channel.attach(wire => {if(socket.readyState === WebSocket.OPEN) socket.send(wire);}, frame.ack);
        return;
      }
      const session = sessions.get(id);
      if (session?.socket === socket) {
        if (frame?.type === 'bridge-release') { remove(id); return; }
        session.channel.receive(frame);
      }
    });
    socket.on('close', () => {
      clearTimeout(helloDeadline); clearInterval(heartbeat);
      const session = id ? sessions.get(id) : undefined;
      if (session?.socket === socket) {
        session.socket = undefined; session.channel.detach();
        session.timer = setTimeout(() => remove(id!), ttl); session.timer.unref();
      }
    });
  });
  server.on('close', () => { for (const id of sessions.keys()) remove(id); });
  return () => [...sessions.values()].map(s => ({...s.channel.snapshot(),connected:s.socket?.readyState===WebSocket.OPEN}));
}
