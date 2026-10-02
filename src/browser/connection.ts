import {ReliableChannel} from '../shared/reliable-channel';

export function connectRenderer<T>(deliver: (message: T) => void, onFailure: (reason: string) => void = () => {}) {
  const sessionId = crypto.randomUUID();
  let socket: WebSocket | undefined;
  let resume = false, ready = false, stopped = false, attempts = 0, lastMessageAt = Date.now();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let notice: HTMLDivElement | undefined;
  const recoveryKey = 'codex-phone-automatic-reopens';
  function hasUnsentWork() {
    // A draft can be an attachment or an in-progress dictation without text.
    if ([...document.querySelectorAll<HTMLElement>('button[aria-label^="Remove attachment"], button[aria-label^="Remove file"], button[aria-label="Stop dictation"]')]
      .some(element => element.getBoundingClientRect().width > 0)) return true;
    return [...document.querySelectorAll<HTMLElement>('textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]')]
      .some(element => element.getBoundingClientRect().width > 0 && !element.closest('[aria-hidden="true"]') &&
        (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value.trim() : element.textContent?.trim()));
  }
  function automaticReopenAllowed() {
    if (location.protocol !== 'https:' || typeof sessionStorage === 'undefined' || hasUnsentWork()) return false;
    try {
      const now = Date.now();
      const recent = JSON.parse(sessionStorage.getItem(recoveryKey) || '[]');
      const attempts = Array.isArray(recent) ? recent.filter(value => Number.isSafeInteger(value) && now - value < 60_000 && value <= now) : [];
      if (attempts.length >= 3) return false;
      sessionStorage.setItem(recoveryKey, JSON.stringify([...attempts, now]));
      return true;
    } catch { return false; }
  }
  function status(expired = false, reopening = false) {
    if (!expired && (ready || stopped)) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => status(expired), {once:true}); return; }
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'ssh-connection-status';
      notice.setAttribute('role','status');
      Object.assign(notice.style,{position:'fixed',bottom:'max(16px, env(safe-area-inset-bottom))',left:'12px',right:'12px',zIndex:'2147483647',padding:'12px 16px',borderRadius:'12px',background:'#202123',color:'#fff',boxShadow:'0 3px 18px #0006',font:'14px system-ui'});
      document.body.append(notice);
    }
    notice.replaceChildren(document.createTextNode(expired ? reopening ? 'Reopening your Mac connection…' : 'The remote session ended. Your open page is still here. Copy any unsent text before reopening.' : 'Reconnecting to your Mac… Your task will stay open.'));
    if (expired && !reopening) {
      const button = document.createElement('button'); button.textContent = 'Reopen connection';
      Object.assign(button.style,{display:'block',minHeight:'44px',marginTop:'8px',padding:'8px 12px',borderRadius:'8px',border:'1px solid #aaa',background:'#fff',color:'#111'});
      button.onclick = () => location.reload(); notice.append(button);
    }
  }
  const channel = new ReliableChannel<T>(deliver, reason => {
    console.warn('[ssh-bridge] session reset:',reason);
    stopped = true; ready = false; clearTimeout(retry); socket?.close();
    const reopening = automaticReopenAllowed();
    status(true, reopening); if(notice) notice.dataset.reason = reason;
    onFailure(reason);
    if (reopening) {
      const reopen = () => {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', reopen);
        if (hasUnsentWork()) {status(true); return;}
        location.reload();
      };
      setTimeout(reopen, 1200);
      document.addEventListener('visibilitychange', reopen);
    }
  });
  function connect() {
    if (stopped || socket && socket.readyState < WebSocket.CLOSING) return;
    const current = socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/__backend/ipc`);
    lastMessageAt = Date.now();
    const deadline = setTimeout(() => {if (!ready && current === socket) current.close();}, 15_000);
    current.addEventListener('open', () => current.send(JSON.stringify({type:'bridge-hello',sessionId,resume,ack:channel.received})));
    current.addEventListener('message', event => {
      if (current !== socket || stopped) return;
      lastMessageAt = Date.now();
      try {
        const frame = JSON.parse(String(event.data));
        if (frame.type === 'bridge-reset') { channel.abort(); return; }
        if (frame.type === 'bridge-welcome') {
          if (ready) { channel.abort(); return; }
          ready = true; resume = true; attempts = 0; clearTimeout(deadline);
          channel.attach(wire => {if (current.readyState === WebSocket.OPEN) current.send(wire);}, frame.ack);
          if (!stopped) {notice?.remove(); notice = undefined;}
        } else if (ready) channel.receive(frame);
        else channel.abort();
      } catch(error) {console.error('[ssh-bridge] dispatch failed',error);channel.abort('dispatch failed'); }
    });
    current.addEventListener('close', () => {
      clearTimeout(deadline); if (current !== socket) return;
      ready = false; channel.detach();
      if (stopped) return;
      status(); clearTimeout(retry);
      retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15_000));
    });
    current.addEventListener('error', () => current.close());
  }
  const wake = () => {
    if (stopped) return;
    if (ready && socket?.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > 45_000) socket.close();
    if (!ready) { clearTimeout(retry); connect(); }
  };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) wake();});
  window.addEventListener('pagehide', event => {
    // A real unload leaves no renderer to resume. BFCache and ordinary iOS
    // suspension keep their renderer and must retain the reconnecting session.
    if (event.persisted) return;
    stopped = true; ready = false; clearTimeout(retry); channel.detach();
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'bridge-release'}));
    socket?.close();
  });
  connect();
  return (message: T) => {channel.send(message); connect();};
}
