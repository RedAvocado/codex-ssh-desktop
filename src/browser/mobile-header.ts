const headerSelector = 'header[data-app-shell-header-layout]';

// Keep React's controls in place. The phone menu invokes their existing handlers,
// so desktop controls, task permissions, and native dialogs keep their behavior.
export function installMobileHeader(media: MediaQueryList, closeDrawer: () => void) {
  const bar = document.createElement('div'); bar.id = 'ssh-mobile-header';
  const title = document.createElement('span'); title.id = 'ssh-mobile-title';
  const toggle = document.createElement('button'); toggle.type = 'button';
  toggle.id = 'ssh-mobile-more'; toggle.textContent = '•••';
  toggle.setAttribute('aria-label', 'More task actions');
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-controls', 'ssh-mobile-actions');
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.id = 'ssh-mobile-actions';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Task actions');
  panel.hidden = true;
  bar.append(title, toggle); document.body.append(bar, panel);
  let open = false;
  let activeEditor: HTMLInputElement | null | undefined;
  let nativeReturn: {source: HTMLElement; overlaySeen: boolean} | undefined;
  const close = (restoreFocus = false) => {
    open = false; panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && media.matches) toggle.focus();
  };
  function controls() {
    const header = [...document.querySelectorAll<HTMLElement>(headerSelector)].find(element => element.getBoundingClientRect().width > 0);
    const toolbar = header?.querySelector<HTMLElement>('[data-app-shell-header-toolbar]');
    const editor = header?.querySelector<HTMLInputElement>('input[aria-label="Chat title"]');
    const isTask = !!editor || !!header?.querySelector('button[aria-label="Chat actions"]');
    const name = isTask ? toolbar?.querySelector<HTMLButtonElement>(':scope > div:first-child button') : undefined;
    const pageHeading = toolbar?.querySelector<HTMLElement>('h1, h2, [role="heading"]');
    const selectedPage = toolbar?.querySelector<HTMLElement>('[role="group"] button[aria-pressed="true"], [role="tablist"] [aria-selected="true"]');
    // Search fields and other forms must remain usable. Keep the original
    // header on layouts this compact control surface does not yet represent.
    const supported = !!header && !header.querySelector('input:not([aria-label="Chat title"]), select, textarea, [contenteditable="true"]');
    const seen = new Set<string>();
    const actions = [...(header?.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('button, a[href]') ?? [])].filter(button => {
      const label = button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent?.trim();
      if (!label || button === name || button.closest('[aria-hidden="true"]') ||
        button.hasAttribute('data-app-shell-sidebar-trigger') || seen.has(label)) return false;
      if (button instanceof HTMLButtonElement && button.disabled && (label === 'Back' || label === 'Forward')) return false;
      seen.add(label); return true;
    });
    return {header, name, editor, isTask, supported, actions, title: editor?.value || name?.textContent?.trim() || pageHeading?.textContent?.trim() || selectedPage?.textContent?.trim() || 'Codex'};
  }
  const labels: Record<string, string> = {
    'Chat actions': 'Task options…', 'Toggle summary': 'Task summary',
    'Toggle bottom panel': 'Bottom panel', 'Toggle side panel': 'Side panel',
  };
  toggle.onclick = () => {
    if (!media.matches) return;
    if (open) { close(true); return; }
    closeDrawer();
    const {name, actions} = controls();
    const heading = document.createElement('div'); heading.className = 'ssh-mobile-actions-title';
    heading.textContent = title.textContent;
    panel.replaceChildren(heading);
    const add = (source: HTMLButtonElement | HTMLAnchorElement, label: string) => {
      const item = document.createElement('button'); item.type = 'button';
      item.textContent = label; item.disabled = source instanceof HTMLButtonElement && source.disabled;
      const pressed = source.getAttribute('aria-pressed');
      if (pressed !== null) item.setAttribute('aria-pressed', pressed);
      item.onclick = () => {
        close(true);
        // Let this menu's click finish before the native menu opens, otherwise
        // native outside-click handling can immediately dismiss the new menu.
        requestAnimationFrame(() => {
          if (!media.matches || !source.isConnected || (source instanceof HTMLButtonElement && source.disabled)) return;
          nativeReturn = {source, overlaySeen: false};
          // Radix dropdown triggers open on pointerdown; ordinary buttons use
          // click. Preserve the normal activation sequence for both kinds.
          source.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, cancelable:true, pointerType:'mouse', button:0}));
          source.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, cancelable:true, pointerType:'mouse', button:0}));
          source.click();
        });
      };
      panel.append(item);
    };
    if (name) add(name, 'Rename task');
    for (const source of actions) {
      const label = source.getAttribute('aria-label') || source.getAttribute('title') || source.textContent!.trim();
      add(source, labels[label] || label);
    }
    open = true; panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };
  document.addEventListener('pointerdown', event => {
    if (open && event.target instanceof Node && !panel.contains(event.target) && !toggle.contains(event.target)) close();
  });
  document.addEventListener('focusin', event => {
    if (open && event.target instanceof Node && !panel.contains(event.target) && !toggle.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') {event.preventDefault(); close(true);}
  });
  const sync = () => {
    if (!media.matches) {
      nativeReturn = undefined;
      close(); document.documentElement.classList.remove('ssh-mobile-header-active', 'ssh-mobile-title-editing'); return;
    }
    if (nativeReturn) {
      const overlay = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"]')]
        .some(element => element !== panel && element.getBoundingClientRect().width > 0);
      if (overlay) nativeReturn.overlaySeen = true;
      else if (nativeReturn.overlaySeen) {
        const {source} = nativeReturn; nativeReturn = undefined;
        // Native popups return focus to their original desktop trigger, which
        // is hidden on phones. Restore the visible equivalent after cleanup.
        requestAnimationFrame(() => {
          const focused = document.activeElement;
          if (media.matches && (focused === document.body || focused === source ||
            (focused instanceof HTMLElement && !focused.getBoundingClientRect().width))) toggle.focus();
        });
      }
    }
    const {editor, isTask, supported, title: text} = controls();
    document.documentElement.classList.toggle('ssh-mobile-header-active', supported);
    const toggleLabel = isTask ? 'More task actions' : 'More page actions';
    if (toggle.getAttribute('aria-label') !== toggleLabel) toggle.setAttribute('aria-label', toggleLabel);
    const panelLabel = isTask ? 'Task actions' : 'Page actions';
    if (panel.getAttribute('aria-label') !== panelLabel) panel.setAttribute('aria-label', panelLabel);
    if (!supported) close();
    document.documentElement.classList.toggle('ssh-mobile-title-editing', !!editor);
    if (editor && editor !== activeEditor) requestAnimationFrame(() => {if (media.matches && editor.isConnected) {editor.focus(); editor.select();}});
    activeEditor = editor;
    if (title.textContent !== text) { title.textContent = text; title.title = text; close(); }
  };
  media.addEventListener('change', sync);
  return {sync, close};
}
