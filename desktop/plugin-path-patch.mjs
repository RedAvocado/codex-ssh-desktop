export function patchBrowserServicePath(source) {
  const pattern = /`\$\{\w+\.\w+\(\{codexHome:\w+,localVersion:\w+,marketplaceName:\w+,pluginName:\w+\.\w+\}\)\}\/scripts\/browser-service\.mjs`/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw Error(`Browser service path: expected one desktop entry, found ${matches.length}`);
  return source.replace(pattern, expression => `globalThis.__codexResolveBrowserService(${expression})`);
}
