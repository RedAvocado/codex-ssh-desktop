const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mapBrowserPathToInitialRoute, mapMemoryPathToBrowserPath, createBrowserNavigationSync} = require('../src/browser/routes.ts');

function browserAt(path = '/') {
  const stack = [{url: new URL(path, 'https://viewer.test'), state: {other: 'preserved'}}];
  let cursor = 0;
  const calls = [];
  const messages = [];
  const listeners = new Map();
  const browser = {
    get location() { return stack[cursor].url; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    dispatchEvent(event) { if (event.type === 'message') messages.push(event.data); return true; },
    document: {title: 'Codex'},
    history: {
      get state() { return stack[cursor].state; },
      pushState(state, _, path) { calls.push(['push', path]); stack.splice(++cursor); stack.push({url: new URL(path, 'https://viewer.test'), state}); },
      replaceState(state, _, path) { calls.push(['replace', path]); stack[cursor] = {url: new URL(path, 'https://viewer.test'), state}; },
      go(delta) { calls.push(['go', delta]); cursor += delta; assert.ok(stack[cursor], 'history destination exists'); listeners.get('popstate')?.(); },
    },
  };
  return {browser, calls, stack, messages, back() { cursor--; listeners.get('popstate')?.(); }, forward() { cursor++; listeners.get('popstate')?.(); }};
}
function nav(path, action = 'PUSH', delta = 1) {
  const {pathname, search, hash} = new URL(path, 'https://viewer.test');
  return {action, delta, location: {pathname, search, hash}};
}

test('non-task page URLs preserve their page, filters, and fragments through reload', () => {
  for (const path of ['/skills/plugins', '/skills/manage/plugins/example', '/plugins/example', '/automations', '/settings/personalization', '/projects', '/g/project-id/project', '/library', '/agents/a/example', '/c/chat-id', '/g/gizmo-id/c/chat-id']) {
    const search = '?hostId=remote&projectId=project-1';
    assert.equal(mapBrowserPathToInitialRoute(path, search, '#details').memoryPath, path + search + '#details');
    assert.equal(mapMemoryPathToBrowserPath(path, search, '#details').path, path + search + '#details');
  }
});
test('task route alias retains host selection and safely round-trips encoded identifiers', () => {
  assert.equal(mapBrowserPathToInitialRoute('/thread/task%3A123', '?hostId=remote', '#turn-2').memoryPath, '/local/task:123?hostId=remote#turn-2');
  assert.equal(mapMemoryPathToBrowserPath('/local/task:123', '?hostId=remote', '#turn-2').path, '/thread/task%3A123?hostId=remote#turn-2');
  for (const path of ['/thread/bad%2Fpath', '/thread/bad%3Fquery', '/thread/%']) assert.equal(mapBrowserPathToInitialRoute(path, '').memoryPath, '/');
});
test('share receiver still transfers the prompt once and clears the receiver URL', () => {
  const mapped = mapBrowserPathToInitialRoute('/share/receive', '?title=Example&text=hello&url=https%3A%2F%2Fexample.com');
  assert.equal(mapped.browserPath, '/');
  assert.equal(new URL(mapped.memoryPath, 'https://viewer.test').searchParams.get('prompt'), 'title: Example\ntext: hello\nurl: https://example.com');
});
test('backend paths, arbitrary URLs, and path traversal cannot become renderer page URLs', () => {
  for (const path of ['/__health', '/__session', '/@fs/private', '/assets/app.js', '//elsewhere.test', 'https://elsewhere.test', '/skills/../__health', '/skills/%2e%2e/__health', '/skills/a%2Fb', '/skills/%', '/skills\\evil']) {
    assert.equal(mapBrowserPathToInitialRoute(path, '?x=1').memoryPath, '/', path);
    assert.equal(mapMemoryPathToBrowserPath(path, '?x=1'), null, path);
  }
});
test('all pathname changes close the drawer, including Plugins and POP, while query-only changes do not', () => {
  const {browser} = browserAt('/thread/task-1');
  const sync = createBrowserNavigationSync('/local/task-1', browser);
  assert.equal(sync(nav('/skills/plugins')), true);
  assert.equal(sync(nav('/skills/plugins?tab=installed')), false);
  assert.equal(browser.location.pathname + browser.location.search, '/skills/plugins?tab=installed');
  assert.equal(sync(nav('/local/task-1', 'POP', -2)), true);
  assert.equal(browser.location.pathname, '/thread/task-1');
});
test('browser Back and Forward preserve page filters without adding duplicate entries', () => {
  const fixture = browserAt('/');
  const sync = createBrowserNavigationSync('/', fixture.browser);
  sync(nav('/projects?projectId=one'));
  sync(nav('/skills/plugins?tab=installed'));
  fixture.back();
  assert.deepEqual(fixture.messages.at(-1), {type: 'navigate-to-route', path: '/projects?projectId=one'});
  const count = fixture.calls.length;
  assert.equal(sync(nav('/projects?projectId=one')), true);
  assert.equal(fixture.calls.length, count, 'browser-originated navigation is already synchronized');
  fixture.forward();
  assert.deepEqual(fixture.messages.at(-1), {type: 'navigate-to-route', path: '/skills/plugins?tab=installed'});
  assert.equal(sync(nav('/skills/plugins?tab=installed')), true);
  assert.equal(fixture.stack.length, 3);
});
test('native Back/Forward traverse matching browser entries instead of pushing duplicates', () => {
  const {browser, calls, stack, messages} = browserAt('/');
  const sync = createBrowserNavigationSync('/', browser);
  sync(nav('/skills/plugins'));
  sync(nav('/automations?automationMode=create'));
  sync(nav('/skills/plugins', 'POP', -1));
  assert.deepEqual(calls.at(-1), ['go', -1]);
  sync(nav('/automations?automationMode=create', 'POP', 1));
  assert.deepEqual(calls.at(-1), ['go', 1]);
  assert.equal(stack.length, 3);
  assert.equal(messages.length, 0, 'native POP must not push the same route into renderer history again');
});
test('renderer replacement and unmatched POP replace the current entry, retaining unrelated state', () => {
  const {browser, calls, stack} = browserAt('/');
  const sync = createBrowserNavigationSync('/', browser);
  sync(nav('/skills/plugins', 'REPLACE', 0));
  assert.deepEqual(calls.at(-1), ['replace', '/skills/plugins']);
  sync(nav('/projects?projectId=one', 'POP', -1));
  assert.deepEqual(calls.at(-1), ['replace', '/projects?projectId=one']);
  assert.equal(stack.length, 1);
  assert.equal(browser.history.state.other, 'preserved');
});
