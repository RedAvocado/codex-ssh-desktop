// A framed phone viewer can ask its own private shell to show the computer
// picker. The shell remains the authority for device availability and routing.
export function installPhoneComputer(media: MediaQueryList, parentOrigin: string | null) {
  let origin: string | undefined;
  try {
    if (parentOrigin && window.parent !== window) {
      const parsed = new URL(parentOrigin);
      if (parsed.protocol === 'https:' && parsed.origin === parentOrigin) origin = parsed.origin;
    }
  } catch { /* A malformed frame link cannot enable computer controls. */ }
  if (!origin) return undefined;

  const button = document.createElement('button');
  button.id = 'ssh-computer-switch'; button.type = 'button';
  document.body.append(button);
  let name = 'Switch computer';
  let lastPlacement: 'drawer' | 'header' = 'drawer';
  const update = () => {
    button.textContent = `${name}  ⌄`;
    button.setAttribute('aria-label', `Switch computer, current computer: ${name}`);
    button.title = name;
  };
  const open = (placement: 'drawer' | 'header') => {
    if (media.matches) {lastPlacement = placement; window.parent.postMessage({type:'codex-computer-menu', placement}, origin);}
  };
  button.onclick = () => open('drawer'); update();
  const sync = () => {
    if (!media.matches) return;
    const mode = document.querySelector<HTMLButtonElement>('.app-shell-left-panel button[aria-label^="Switch mode"]');
    document.documentElement.classList.toggle('ssh-phone-computer-active', !!mode);
  };
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== origin || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'codex-computer-state' && typeof event.data.name === 'string' && event.data.name.trim() && event.data.name.length <= 80) {
      name = event.data.name.trim(); update();
    } else if (event.data.type === 'codex-computer-focus' && media.matches) {
      const target = lastPlacement === 'header' ? document.getElementById('ssh-mobile-more') : button;
      if (target?.getBoundingClientRect().width) target.focus();
    }
  });
  window.parent.postMessage({type:'codex-computer-ready'}, origin);
  media.addEventListener('change', () => {
    if (!media.matches) document.documentElement.classList.remove('ssh-phone-computer-active');
    else sync();
  });
  return {sync, open, getName: () => name};
}
