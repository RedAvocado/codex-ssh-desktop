import Module from "node:module";
import path from "node:path";
import {adaptNativeAddon} from './native-compat';
import {resolveBrowserServicePath} from './plugin-paths';

export function installModuleAliasHook(): void {
  Object.assign(globalThis, {__codexResolveBrowserService: resolveBrowserServicePath});
  const moduleWithLoad = Module as typeof Module & {
    _load: (
      request: string,
      parent: NodeModule | undefined,
      isMain: boolean,
    ) => unknown;
  };
  const originalLoad = moduleWithLoad._load;

  moduleWithLoad._load = function moduleAliasLoad(
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
  ): unknown {
    if (request === "electron") {
      return originalLoad.call(this, path.resolve(
        path.resolve(__dirname, "../.."),
        "src/server/electron/index.js",
      ), parent, isMain);
    }

    return adaptNativeAddon(request, originalLoad.call(this, request, parent, isMain));
  };
}
