// These are renderer pages, not arbitrary URLs or backend endpoints. Keep the
// allowlist in step with the shipped renderer when adding new phone routes.
function isPagePath(pathname: string): boolean {
  if (/[\\?#\u0000-\u001f]/.test(pathname) || pathname.startsWith('//')) return false;
  try {
    if (pathname.split('/').some(part => {
      const value = decodeURIComponent(part);
      return value === '.' || value === '..' || /[\/\\\u0000-\u001f]/.test(value);
    })) return false;
  } catch { return false; }
  return pathname === '/' || pathname === '/projects' ||
    /^\/(?:skills|plugins|automations|settings|library|agents)(?:\/[^?#]*)?$/.test(pathname) ||
    /^\/g\/[^/]+\/project$/.test(pathname) ||
    /^\/c\/[^/]+$/.test(pathname) || /^\/g\/[^/]+\/c\/[^/]+$/.test(pathname);
}

function suffix(search: string, hash: string): string {
  return (search.startsWith('?') ? search : '') + (hash.startsWith('#') ? hash : '');
}

export function mapBrowserPathToInitialRoute(pathname: string, search: string, hash = '') {
  if (pathname === "/share/receive" && search) {
    const params = new URLSearchParams(search);

    const prompt = ["title", "text", "url"]
      .flatMap((name) => {
        const value = params.get(name);
        return value === null ? [] : [`${name}: ${value}`];
      })
      .join("\n");

    return {
      memoryPath: prompt
        ? `/?${new URLSearchParams({ prompt }).toString()}`
        : "/",
      browserPath: "/",
    };
  }

  return {
    memoryPath: mapBrowserPathToRoute(pathname, search, hash),
  };
}

function mapBrowserPathToRoute(pathname: string, search = '', hash = ''): string {
  const match = pathname.match(/^\/thread\/([^/]+)$/);
  if (match) {
    try {
      const id = decodeURIComponent(match[1]);
      if (!id || /[/?#\\\u0000-\u001f]/.test(id)) return '/';
      return `/local/${id}${suffix(search, hash)}`;
    } catch {
      return "/";
    }
  }

  return isPagePath(pathname) ? pathname + suffix(search, hash) : '/';
}

export function mapMemoryPathToBrowserPath(pathname: string, search = '', hash = '') {
  if (pathname === "/") {
    return { path: '/' + suffix(search, hash), titleChange: 'Codex' };
  }

  const match = pathname.match(/^\/local\/([^/?#]+)$/);
  if (!match) {
    return isPagePath(pathname) ? {path: pathname + suffix(search, hash)} : null;
  }

  if (/[\\\u0000-\u001f]/.test(match[1])) return null;
  return { path: `/thread/${encodeURIComponent(match[1])}${suffix(search, hash)}` };
}

type Navigation = {
  action: 'POP' | 'PUSH' | 'REPLACE';
  delta: number;
  location: {pathname: string; search: string; hash: string};
};

// A POP initiated by the renderer must not create a new browser entry. Track
// this page's entries so native Back/Forward can use the matching browser entry;
// a browser-originated pop already has the destination URL and is a no-op here.
export function createBrowserNavigationSync(initialMemoryPath: string, browser: Pick<Window, 'history' | 'location' | 'document' | 'addEventListener' | 'dispatchEvent'> = window) {
  const key = '__codexViewerHistoryIndex';
  const currentUrl = () => browser.location.pathname + browser.location.search + browser.location.hash;
  const state = () => browser.history.state && typeof browser.history.state === 'object' ? browser.history.state : {};
  const index = () => Number.isInteger(state()[key]) ? state()[key] as number : 0;
  const entries = new Map<number, string>([[index(), currentUrl()]]);
  let previousPathname = initialMemoryPath.split(/[?#]/, 1)[0];
  let rendererPopDestination: string | null = null;
  browser.addEventListener('popstate', () => {
    const expected = rendererPopDestination;
    rendererPopDestination = null;
    // The renderer has already performed this Back/Forward. Sending it another
    // navigate message would push a duplicate and discard its forward history.
    if (expected === currentUrl()) return;
    dispatchNavigateToRoute(mapBrowserPathToRoute(browser.location.pathname, browser.location.search, browser.location.hash), browser);
  });
  browser.history.replaceState({...state(), [key]: index()}, '', currentUrl());
  return (navigation: Navigation): boolean => {
    const {pathname, search, hash} = navigation.location;
    const changedPath = pathname !== previousPathname;
    previousPathname = pathname;
    const target = mapMemoryPathToBrowserPath(pathname, search, hash);
    if (!target) return changedPath;
    if ('titleChange' in target) browser.document.title = target.titleChange!;
    const here = index();
    if (target.path === currentUrl()) { entries.set(here, target.path); return changedPath; }
    if (navigation.action === 'POP' && Number.isInteger(navigation.delta) && navigation.delta !== 0 && entries.get(here + navigation.delta) === target.path) {
      rendererPopDestination = target.path;
      browser.history.go(navigation.delta);
    } else if (navigation.action === 'PUSH') {
      for (const entry of entries.keys()) if (entry > here) entries.delete(entry);
      entries.set(here + 1, target.path);
      browser.history.pushState({...state(), [key]: here + 1}, '', target.path);
    } else {
      entries.set(here, target.path);
      browser.history.replaceState({...state(), [key]: here}, '', target.path);
    }
    return changedPath;
  };
}

export function dispatchNavigateToRoute(path: string, target: Pick<Window, 'dispatchEvent'> = window): void {
  target.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "navigate-to-route",
        path,
      },
    }),
  );
}
