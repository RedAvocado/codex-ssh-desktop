'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const frames = new Map();
  let computers = [], selected, pending, switching = false, menuOpen = false, checked = false, availabilityError = false, timer, messageTimer, optionsSignature;
  const initial = new URL(location.href);
  const requested = initial.searchParams.get('computer');
  const firstPath = requested ? '/' : location.pathname + location.search + location.hash;
  // Preferences contain computer IDs and page routes. Authentication and drafts remain
  // inside each host's own origin and its retained, independent renderer.
  let preferred; try {preferred = sessionStorage.getItem('codex-computer');} catch {}
  let routes = {}; try {const saved = JSON.parse(sessionStorage.getItem('codex-computer-routes')); if (saved && typeof saved === 'object' && !Array.isArray(saved)) routes = saved;} catch {}
  const safePath = path => typeof path === 'string' && path.length <= 16384 && path.startsWith('/') && !/^\/[/\\]/.test(path) && !/[\\\u0000-\u001f]/.test(path) ? path : '/';
  function rememberSelection() {
    const url = new URL(location.href); url.searchParams.set('computer', selected);
    url.searchParams.set('path', safePath(routes[selected]));
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function menu(open, focus = false) {
    menuOpen = open; $('computers').hidden = !open;
    $('computer').setAttribute('aria-expanded', String(open));
    for (const frame of frames.values()) frame.inert = open;
    if (focus) (open ? $('computer-options').querySelector('button:not(:disabled)') || $('refresh') : $('computer')).focus();
  }
  function say(text) {
    clearTimeout(messageTimer); $('message').textContent = text; $('message').hidden = false;
    messageTimer = setTimeout(() => {$('message').hidden = true;}, 6000);
  }
  function render() {
    const current = computers.find(c => c.id === selected);
    $('computer-name').textContent = current?.name || 'Choose a computer';
    $('connection').textContent = switching ? 'Connecting…' : current && availabilityError ? 'Availability unknown' : current && !current.online ? 'Offline' : '';
    const options = computers.filter(c => c.online || c.id === selected);
    const focused = document.activeElement?.dataset?.computer;
    const signature = JSON.stringify([options, selected, switching]);
    if (signature !== optionsSignature) {
      optionsSignature = signature;
      $('computer-options').replaceChildren(...options.map(computer => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.computer = computer.id;
      const name = document.createElement('span'); name.textContent = computer.name;
      const state = document.createElement('span'); state.className = 'state';
      state.textContent = computer.id === selected ? computer.online ? '✓' : 'Offline' : 'Online';
      button.append(name, state); button.disabled = switching || !computer.online;
      button.setAttribute('aria-label', `${computer.name}, ${computer.id === selected ? 'selected, ' : ''}${computer.online ? 'online' : 'offline'}`);
      button.onclick = () => select(computer.id); return button;
      }));
      if (focused && menuOpen) {
        const target = [...$('computer-options').children].find(button => button.dataset.computer === focused && !button.disabled);
        (target || $('refresh')).focus();
      }
    }
    const online = computers.filter(c => c.online).length;
    $('availability').textContent = !checked ? 'Checking availability…' : online ? 'Only online computers are available to switch to.' : 'No computers are available. Check that a Mac is awake and Tailscale is connected.';
    $('empty').hidden = !!selected && frames.has(selected);
    if (!$('empty').hidden && checked) {
      $('empty-title').textContent = 'Choose an online computer';
      $('empty-help').textContent = online ? 'Open the computer menu above to connect.' : 'Keep a Mac awake, signed in, and connected to Tailscale.';
    }
  }
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch('/__phone/computers', {cache:'no-store', signal:AbortSignal.timeout(5000)});
        if (!response.ok) throw Error('Unavailable');
        const result = await response.json();
        if (!Array.isArray(result.computers) || !result.computers.length) throw Error('Unavailable');
        computers = result.computers; checked = true; availabilityError = false; render(); return true;
      } catch {
        computers = computers.map(c => ({...c, online:false})); checked = true; availabilityError = true; render();
        $('availability').textContent = 'Cannot check availability. Reconnect Tailscale and try again.';
        return false;
      } finally {pending = undefined;}
    })();
    return pending;
  }
  async function select(id) {
    if (switching) return;
    if (id === selected) {menu(false, true); return;}
    switching = true; render();
    const fresh = await refresh();
    const computer = computers.find(c => c.id === id);
    if (!fresh || !computer?.online) {
      switching = false; render(); say('That computer is offline. Your current view is still open.'); return;
    }
    let frame = frames.get(id);
    if (!frame) {
      frame = document.createElement('iframe'); frame.title = computer.name;
      // Keep navigation inside this Home Screen app. Origins are individually
      // configured by the owner; no proxy, shared credential, or wildcard frame permission.
      const destination = new URL('/__phone/viewer', computer.origin);
      const explicit = id === requested ? initial.searchParams.get('path') : !requested && !selected && computer.origin === location.origin && firstPath !== '/' ? firstPath : null;
      const path = safePath(explicit || routes[id] || '/');
      routes[id] = path;
      destination.searchParams.set('path', path);
      destination.searchParams.set('parent', location.origin);
      frame.src = destination.href;
      frame.allow = 'microphone';
      frame.hidden = true;
      frames.set(id, frame); $('viewers').append(frame);
    }
    for (const [key, other] of frames) other.hidden = key !== id;
    selected = id; switching = false;
    try {sessionStorage.setItem('codex-computer', id);} catch {}
    // Record selection without pushing cross-host task identifiers into the
    // other computer. Each iframe keeps its own navigation and unsent input.
    rememberSelection();
    menu(false, true); render();
  }
  window.addEventListener('message', event => {
    if (event.data?.type !== 'codex-computer-route' || typeof event.data.path !== 'string') return;
    const computer = computers.find(c => c.origin === event.origin && frames.get(c.id)?.contentWindow === event.source);
    if (!computer) return;
    routes[computer.id] = safePath(event.data.path);
    try {sessionStorage.setItem('codex-computer-routes', JSON.stringify(routes));} catch {}
    if (computer.id === selected) rememberSelection();
  });
  $('computer').onclick = () => {menu(!menuOpen, true); if (menuOpen) refresh();};
  $('refresh').onclick = () => refresh();
  $('retry').onclick = () => {menu(true, true); refresh();};
  document.addEventListener('pointerdown', event => {if (menuOpen && !$('computers').contains(event.target) && !$('computer').contains(event.target)) menu(false);});
  document.addEventListener('keydown', event => {
    if (!menuOpen) return;
    if (event.key === 'Escape') {event.preventDefault(); menu(false, true);}
    if (event.key === 'Tab') {
      const buttons = [...$('computers').querySelectorAll('button:not(:disabled)')];
      if (event.shiftKey && document.activeElement === buttons[0]) {event.preventDefault(); buttons.at(-1)?.focus();}
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {event.preventDefault(); buttons[0]?.focus();}
    }
  });
  const schedule = () => {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(async () => {await refresh(); schedule();}, 15000);
  };
  const wake = async () => {if (!document.hidden) await refresh(); schedule();};
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  window.addEventListener('pageshow', schedule);
  refresh().then(() => {
    const wanted = requested || (firstPath !== '/' ? computers.find(c => c.origin === location.origin)?.id : preferred);
    const initialComputer = computers.find(c => c.id === wanted && c.online) || computers.find(c => c.origin === location.origin && c.online) || computers.find(c => c.online);
    if (initialComputer) select(initialComputer.id); else {render(); menu(true);}
    schedule();
  });
})();
