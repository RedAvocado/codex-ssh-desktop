import mobileStyles from './mobile.css?inline';
import {installMobileHeader} from './mobile-header';
import {MOBILE_QUERY} from './mobile-viewport';

// The desktop drawer reserves space for macOS window controls and installs
// sortable touch sensors. Keep its contents, but give phones native scrolling
// and a predictable overlay that does not shrink the conversation.
export function installMobileLayout(closeOnNavigation: (close: () => void) => void) {
  const media = matchMedia(MOBILE_QUERY);
  const start = () => {
    const style = document.createElement('style'); style.textContent = mobileStyles; document.head.append(style);
    const button = document.createElement('button'); button.id = 'ssh-mobile-menu';
    button.type = 'button'; button.setAttribute('aria-label','Open task drawer');
    button.setAttribute('aria-controls','app-shell-sidebar'); button.setAttribute('aria-expanded','false');
    button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const scrim = document.createElement('button'); scrim.id = 'ssh-mobile-scrim';
    scrim.type = 'button'; scrim.setAttribute('aria-label','Close task drawer'); scrim.tabIndex = -1;
    let open = false;
    let expanding = false;
    let desktopSidebarExpanded: boolean | undefined;
    const originalInert = new Map<HTMLElement, boolean>();
    function phoneInert(element: HTMLElement | null, value: boolean) {
      if (!element || !media.matches) return;
      if (value) {
        if (!originalInert.has(element)) originalInert.set(element, element.inert);
        if (!element.inert) element.inert = true;
      } else if (originalInert.has(element)) {
        element.inert = originalInert.get(element)!;
        originalInert.delete(element);
      }
    }
    const header = installMobileHeader(media, () => setOpen(false));
    function setOpen(value: boolean) {
      open = value && media.matches;
      if(open) header.close();
      document.documentElement.classList.toggle('ssh-drawer-open',open);
      button.setAttribute('aria-expanded',String(open));
      button.setAttribute('aria-label',open ? 'Close task drawer' : 'Open task drawer');
      const aside = document.querySelector<HTMLElement>('.app-shell-left-panel');
      phoneInert(aside, !open);
      phoneInert(document.querySelector<HTMLElement>('main[data-app-shell-main-surface]'), open);
    }
    button.onclick = () => setOpen(!open); scrim.onclick = () => {setOpen(false); button.focus();};
    document.body.append(button,scrim);
    closeOnNavigation(() => {setOpen(false); header.close();});
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !open || e.defaultPrevented) return;
      // Let a nested native menu or dialog consume Escape first.
      if (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"]')) return;
      setOpen(false); button.focus();
    });
    const sync = () => {
      header.sync();
      if (!media.matches) return;
      for (const element of originalInert.keys()) {if (!element.isConnected) originalInert.delete(element);}
      const aside = document.querySelector<HTMLElement>('.app-shell-left-panel');
      phoneInert(aside, !open);
      // The shell creates an isolated stacking context. A scrim under body
      // would cover the entire shell, including its higher-z-index drawer.
      if (aside?.parentElement && scrim.parentElement !== aside.parentElement) aside.parentElement.append(scrim);
      const main = document.querySelector<HTMLElement>('main[data-app-shell-main-surface]');
      phoneInert(main, open);
      // The desktop shell can unmount the drawer's contents when collapsed.
      // Expand its internal state once; phone CSS controls its visible state.
      if (media.matches && !expanding && (!aside || !aside.querySelector('#app-shell-sidebar'))) {
        const trigger = document.querySelector<HTMLButtonElement>('[data-app-shell-sidebar-trigger][aria-expanded="false"]');
        if(trigger){expanding = true; trigger.click(); requestAnimationFrame(() => {expanding = false;});}
      }
    };
    new MutationObserver(sync).observe(document.body,{childList:true,characterData:true,subtree:true}); sync();
    media.addEventListener('change',() => {
      const trigger = document.querySelector<HTMLButtonElement>('[data-app-shell-sidebar-trigger]');
      if (media.matches) desktopSidebarExpanded = trigger ? trigger.getAttribute('aria-expanded') === 'true' : undefined;
      setOpen(false);
      if (!media.matches) {
        for (const [element, inert] of originalInert) {if(element.isConnected) element.inert = inert;}
        originalInert.clear();
        if (trigger && desktopSidebarExpanded !== undefined && (trigger.getAttribute('aria-expanded') === 'true') !== desktopSidebarExpanded) trigger.click();
        desktopSidebarExpanded = undefined;
      }
      sync();
    });
    // DndKit checks this native-event marker before activating its sensor.
    // Leave propagation/default behavior intact for nested menu controls and
    // native vertical panning. The prepared desktop bundle uses this guard.
    const stopDrag = (event: Event) => {
      if (!media.matches || !(event.target instanceof Element)) return;
      if (event.type === 'pointerdown' && (event as PointerEvent).pointerType !== 'touch') return;
      if (event.target.closest('.app-shell-left-panel [data-app-action-sidebar-thread-row], .app-shell-left-panel .sidebar-item[role="button"], .app-shell-left-panel [aria-roledescription="sortable"], .app-shell-left-panel [draggable="true"]')) {
        (event as Event & {dndKit?: unknown}).dndKit ??= {capturedBy:'mobile-scroll'};
      }
    };
    document.addEventListener('pointerdown',stopDrag,true);
    document.addEventListener('touchstart',stopDrag,{capture:true,passive:true});
    document.addEventListener('dragstart',e => {
      if (media.matches && e.target instanceof Element && e.target.closest('.app-shell-left-panel')) e.preventDefault();
    },true);
    document.addEventListener('click',e => {
      if (media.matches && e.target instanceof Element && e.target.closest('.app-shell-left-panel a[href]')) setOpen(false);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
}
