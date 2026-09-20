#!/usr/bin/env node

declare global {
  var __CODEX_SHIM_VALUES__: {
    version: string;
  };
}

import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs as parseCliArgs } from "node:util";
import { WebSocket, WebSocketServer } from "ws";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { installModuleAliasHook } from "./module";
import { glob } from "glob";
import {authorized, bearerToken, tokenMatches, validHost, viewerOrigin} from './access';
import {startOutboundProxy} from './outbound-proxy';
import {resumableBridge} from './resumable-bridge';
import {registerLocalTranscription} from './local-transcription';

type ServerOptions = {
  host: string;
  port: number;
};

type RendererToMainMessage =
  | {
      type: "ipc-renderer-invoke";
      requestId: string;
      channel: string;
      args: unknown[];
      sourceUrl: string;
    }
  | {
      type: "ipc-renderer-send";
      channel: string;
      args: unknown[];
      sourceUrl: string;
    }
  | {
      type: "ipc-renderer-post-message";
      channel: string;
      message: unknown;
      portIds: string[];
      sourceUrl?: string;
    }
  | {
      type: "message-port-message";
      portId: string;
      data: unknown;
    }
  | {
      type: "message-port-close";
      portId: string;
    }
  | {
      type: "workspace-directory-entries-request";
      requestId: string;
      directoryPath: string | null;
      directoriesOnly: boolean;
    };

type MainToRendererMessage =
  | {
      type: "ipc-main-event";
      channel: string;
      args: unknown[];
    }
  | {
      type: "ipc-renderer-invoke-result";
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "ipc-renderer-invoke-result";
      requestId: string;
      ok: false;
      errorMessage: string;
    }
  | {
      type: "workspace-directory-entries-result";
      requestId: string;
      ok: true;
      result: WorkspaceDirectoryEntries;
    }
  | {
      type: "workspace-directory-entries-result";
      requestId: string;
      ok: false;
      errorMessage: string;
    }
  | {
      type: "message-port-message";
      portId: string;
      data: unknown;
    }
  | {
      type: "message-port-close";
      portId: string;
    };

type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

type WorkspaceDirectoryEntries = {
  directoryPath: string;
  parentPath: string | null;
  entries: WorkspaceDirectoryEntry[];
};

type MessagePortListener = (...args: unknown[]) => void;

type BridgedMessagePort = {
  close: () => void;
  on: (event: string, listener: MessagePortListener) => unknown;
  postMessage: (message: unknown) => void;
  start: () => void;
};

class WebSocketMessagePort implements BridgedMessagePort {
  private closed = false;
  private readonly pendingMessages: unknown[] = [];
  private readonly listeners = new Map<string, Set<MessagePortListener>>();

  constructor(
    private readonly portId: string,
    private readonly sendToRenderer: (message: MainToRendererMessage) => void,
    private readonly onClosed: () => void,
  ) {}

  on(event: string, listener: MessagePortListener): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    if (event === "message") {
      for (const data of this.pendingMessages.splice(0)) {
        this.receiveMessage(data);
      }
    }

    return this;
  }

  postMessage(data: unknown): void {
    if (this.closed) {
      return;
    }
    this.sendToRenderer({
      type: "message-port-message",
      portId: this.portId,
      data,
    });
  }

  start(): void {}

  close(): void {
    if (!this.markClosed()) {
      return;
    }
    this.sendToRenderer({
      type: "message-port-close",
      portId: this.portId,
    });
  }

  receiveMessage(data: unknown): void {
    if (this.closed) {
      return;
    }
    const listeners = this.listeners.get("message");
    if (!listeners || listeners.size === 0) {
      this.pendingMessages.push(data);
      return;
    }
    for (const listener of listeners) {
      listener({ data });
    }
  }

  disconnect(): void {
    if (!this.markClosed()) {
      return;
    }
    this.emit("close");
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  private markClosed(): boolean {
    if (this.closed) {
      return false;
    }
    this.closed = true;
    this.pendingMessages.length = 0;
    this.onClosed();
    return true;
  }
}

function workspaceDirectoryEntryTypeRank(
  entry: WorkspaceDirectoryEntry,
): number {
  return entry.type === "directory" ? 0 : 1;
}

function workspaceDirectoryEntryHiddenRank(
  entry: WorkspaceDirectoryEntry,
): number {
  return entry.name.startsWith(".") ? 1 : 0;
}

function compareWorkspaceDirectoryEntries(
  left: WorkspaceDirectoryEntry,
  right: WorkspaceDirectoryEntry,
): number {
  return (
    workspaceDirectoryEntryTypeRank(left) -
      workspaceDirectoryEntryTypeRank(right) ||
    workspaceDirectoryEntryHiddenRank(left) -
      workspaceDirectoryEntryHiddenRank(right) ||
    left.name.localeCompare(right.name)
  );
}

type RendererWindow = {
  id: number;
  webContents: { id: number };
  destroy: () => void;
};

type IpcMainBridgeState = {
  setRendererWindowFactory?: (factory: () => Promise<RendererWindow>) => void;
  sendToRenderer?: (
    webContentsId: number,
    message: MainToRendererMessage,
  ) => void;
  handleRendererInvoke?: (
    channel: string,
    args: unknown[],
    windowId: number,
  ) => Promise<unknown>;
  handleRendererPostMessage?: (
    channel: string,
    message: unknown,
    ports: BridgedMessagePort[],
    windowId: number,
  ) => void;
  handleRendererSend?: (
    channel: string,
    args: unknown[],
    windowId: number,
  ) => void;
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  server [--host <host>] [--port <port>]",
      "",
      "Defaults:",
      "  --host 127.0.0.1",
      "  --port 18314",
      "",
      "Examples:",
      "  node desktop/control.cjs status",
      "  Start the remote runtime by connecting from the desktop client.",
    ].join("\n"),
  );
}

function parsePort(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return parsed;
}

function parseServerArgs(args: string[]): ServerOptions {
  const parsed = parseCliArgs({
    args,
    allowPositionals: false,
    options: {
      help: {
        short: "h",
        type: "boolean",
      },
      host: {
        type: "string",
      },
      port: {
        type: "string",
      },
    },
    strict: true,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  return {
    host: parsed.values.host ?? "127.0.0.1",
    port: parsed.values.port ? parsePort(parsed.values.port) : 18314,
  };
}

function getIpcMainBridgeState(): IpcMainBridgeState {
  const globals = globalThis as typeof globalThis & {
    __codexElectronIpcBridge?: IpcMainBridgeState;
  };
  if (!globals.__codexElectronIpcBridge) {
    globals.__codexElectronIpcBridge = {};
  }
  return globals.__codexElectronIpcBridge;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

async function getWorkspaceDirectoryEntries({
  directoryPath,
  directoriesOnly,
}: {
  directoryPath: string | null;
  directoriesOnly: boolean;
}): Promise<WorkspaceDirectoryEntries> {
  const requestedPath = directoryPath?.trim() || os.homedir();
  const resolvedPath = path.resolve(requestedPath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Directory not found: ${requestedPath}`);
  }

  const entries = (await fs.readdir(resolvedPath, { withFileTypes: true }))
    .flatMap((entry): WorkspaceDirectoryEntry[] => {
      const type = entry.isDirectory() ? "directory" : "file";
      if (directoriesOnly && type !== "directory") {
        return [];
      }

      return [
        {
          name: entry.name,
          path: path.join(resolvedPath, entry.name),
          type,
        },
      ];
    })
    .sort(compareWorkspaceDirectoryEntries);

  const rootPath = path.parse(resolvedPath).root;
  const parentPath =
    resolvedPath === rootPath ? null : path.dirname(resolvedPath);

  return {
    directoryPath: resolvedPath,
    parentPath,
    entries,
  };
}

function ensureElectronLikeProcessContext(): void {
  process.env.BUILD_FLAVOR = "prod";

  const versions = process.versions as NodeJS.ProcessVersions & {
    electron?: string;
  };
  if (!versions.electron) {
    Object.defineProperty(versions, "electron", {
      value: "41.2.0",
      configurable: true,
      enumerable: true,
      writable: false,
    });
  }

  const processWithElectronFields = process as NodeJS.Process & {
    getSystemVersion?: () => string;
    resourcesPath?: string;
    type?: string;
  };
  const systemVersion =
    process.platform === "darwin"
      ? execFileSync("/usr/bin/sw_vers", ["-productVersion"], {
          encoding: "utf8",
        }).trim()
      : os.release();
  processWithElectronFields.getSystemVersion ??= () => systemVersion;
  processWithElectronFields.resourcesPath ??= process.env.CODEX_REMOTE_DESKTOP_RESOURCES ?? path.resolve(
    __dirname,
    "../../scratch/asar",
  );
  processWithElectronFields.type ??= "browser";
}

async function startIpcBridgeServer(options: ServerOptions): Promise<void> {
  if(options.host!=='127.0.0.1'||options.port!==18314)throw new Error('Codex SSH Desktop viewer must bind to 127.0.0.1:18314');
  const tokenPath=process.env.CODEX_REMOTE_VIEWER_TOKEN_FILE;
  if(!tokenPath)throw new Error('CODEX_REMOTE_VIEWER_TOKEN_FILE is required');
  const viewerToken=(await fs.readFile(tokenPath,'utf8')).trim();
  if(!/^[a-f0-9]{64}$/.test(viewerToken))throw new Error('Invalid viewer connection token');
  await startOutboundProxy(viewerToken);
  const bridgeState = getIpcMainBridgeState();
  const app = Fastify({ logger: false });
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024 * 1024,
    // Startup feature state can be several MB. Compress each message separately
    // so a slow connection does not spend minutes retransmitting that state.
    perMessageDeflate: {serverNoContextTakeover:true,clientNoContextTakeover:true,concurrencyLimit:2,threshold:1024,zlibDeflateOptions:{level:3}},
  });
  let hostReady=false;
  const pendingCalls = new Map<string,{name:string;since:number}>();
  const transport={preloadRequests:0,socketConnections:0,activeSockets:0,received:0,sent:0,registeredViews:0};
  app.addHook('onRequest',async(request,reply)=>{
    if(!validHost(request.headers.host))return reply.code(403).send({error:'Invalid host'});
    if(request.url==='/__session' && request.method==='GET') {
      if(!tokenMatches(bearerToken(request.headers.authorization),viewerToken))return reply.code(401).send({error:'Connect through Codex SSH Desktop'});
      reply.header('Set-Cookie',`remote_session=${viewerToken}; HttpOnly; SameSite=Strict; Path=/`);
      reply.header('Cache-Control','no-store');
      return reply.redirect('/');
    }
    if(request.url==='/__health' && tokenMatches(bearerToken(request.headers.authorization),viewerToken))return;
    if(!authorized(request.headers,viewerToken))return reply.code(401).send({error:'Connect through Codex SSH Desktop'});
    if(request.url==='/assets/preload.js')transport.preloadRequests++;
    reply.header('Cache-Control','no-store');
  });
  let readBridgeDiagnostics: () => unknown[] = () => [];
  app.get('/__health',async()=>({ready:hostReady,host:os.hostname(),pid:process.pid,version:globalThis.__CODEX_SHIM_VALUES__?.version??null,transport,sessions:readBridgeDiagnostics(),pending:[...pendingCalls.values()].map(p=>({name:p.name,ageMs:Date.now()-p.since}))}));
  app.post('/__external',async(request,reply)=>{
    const body=request.body as {url?:string}|null;
    let target:URL;try{target=new URL(body?.url??'');if(!['https:','http:'].includes(target.protocol))throw Error();}catch{return reply.code(400).send({error:'Invalid URL'});}
    await new Promise<void>((resolve,reject)=>execFile('/usr/bin/open',['-a','Google Chrome',target.href],error=>error?reject(error):resolve()));
    return {opened:true,host:os.hostname()};
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 256 * 1024 * 1024,
      files: 8,
    },
  });
  registerLocalTranscription(app, path.resolve(__dirname, '../../runtime'));

  const uploadRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-web-uploads-"),
  );

  app.post("/__backend/upload", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "expected multipart upload body" });
    }

    const files = await Array.fromAsync(
      (async function* () {
        for await (const part of request.files()) {
          const label = part.filename?.trim() || "upload";

          const uploadedPath = path.join(uploadRoot, randomUUID());

          await fs.writeFile(uploadedPath, await part.toBuffer());

          yield {
            label,
            path: uploadedPath,
            fsPath: uploadedPath,
          };
        }
      })(),
    );

    return reply.send({ files });
  });

  // Untrusted files must never execute on the authenticated control origin.
  // Keep previews disabled until a separate, isolated preview origin exists.
  app.get('/@fs/*', async (_request, reply) => reply.code(403).send({error:'File previews are disabled for this private installation.'}));

  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, "../../scratch/asar/webview"),
    prefix: "/",
  });

  app.get("/", async (_request, reply) => {
    return reply.sendFile("index.html");
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/@fs/")) {
      return reply.code(404).send({ error: "Not Found" });
    }

    if (request.method === "GET") {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not Found" });
  });

  app.server.on("upgrade", (request, socket, head) => {
    if(!authorized(request.headers,viewerToken) || request.headers.origin!==viewerOrigin){socket.destroy();return;}
    const requestUrl = request.url ?? "/";
    const host = request.headers.host ?? "localhost";
    const url = new URL(requestUrl, `http://${host}`);
    if (url.pathname !== "/__backend/ipc") {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (upgradedSocket) => {
      websocketServer.emit("connection", upgradedSocket, request);
    });
  });

  const rendererSockets = new Map<number, (message: MainToRendererMessage) => void>();
  const rendererWindowFactory = new Promise<() => Promise<RendererWindow>>(
    (resolve) => {
      bridgeState.setRendererWindowFactory = factory=>{hostReady=true;resolve(factory);};
    },
  );
  bridgeState.sendToRenderer = (id, message): void => {
    transport.sent++;
    rendererSockets.get(id)?.(message);
  };
  websocketServer.on('connection', socket => {
    transport.socketConnections++; transport.activeSockets++;
    socket.on('close', () => transport.activeSockets--);
  });
  readBridgeDiagnostics = resumableBridge<RendererToMainMessage | MainToRendererMessage>(websocketServer, (send, fail) => {
    let rendererWindow: RendererWindow | undefined;
    let disposed = false;
    const initializationDeadline = setTimeout(() => fail('renderer initialization timed out'), 60_000);
    initializationDeadline.unref();
    const rendererReady = rendererWindowFactory.then(async createWindow => {
      if (disposed) return undefined;
      const window = await createWindow();
      if (disposed) { window.destroy(); return undefined; }
      rendererWindow = window;
      transport.registeredViews++;
      rendererSockets.set(window.webContents.id, send);
      return window;
    }).catch(error => {
      console.error('[ipc-bridge] renderer initialization failed', error);
      fail('renderer initialization failed');
      return undefined;
    }).finally(() => clearTimeout(initializationDeadline));
    const messagePorts = new Map<string, WebSocketMessagePort>();
    const dispatchPostMessage = (
      channel: string,
      message: unknown,
      ports: WebSocketMessagePort[],
      windowId: number,
    ): void => {
      const handler = bridgeState.handleRendererPostMessage;
      if (handler) {
        handler(channel, message, ports, windowId);
        return;
      }

      console.error(
        `[ipc-bridge] no ipcMain postMessage handler for channel ${channel}`,
      );
      for (const port of ports) {
        port.close();
      }
    };

    const dispose = () => {
      disposed = true;
      clearTimeout(initializationDeadline);
      for (const port of messagePorts.values()) port.disconnect();
      messagePorts.clear();
      if (rendererWindow) {
        rendererSockets.delete(rendererWindow.webContents.id);
        rendererWindow.destroy();
      }
    };
    const receive = async (input: RendererToMainMessage | MainToRendererMessage) => {
      transport.received++;
      const window = await rendererReady;
      if (!window || disposed) return;
      const message = input as RendererToMainMessage;

      if (message.type === "ipc-renderer-send") {
        bridgeState.handleRendererSend?.(
          message.channel,
          message.args,
          window.id,
        );
        return;
      }

      if (message.type === "ipc-renderer-post-message") {
        if (new Set(message.portIds).size !== message.portIds.length) {
          console.error("[ipc-bridge] duplicate transferred MessagePort id");
          return;
        }

        const ports = message.portIds.map((portId) => {
          const existingPort = messagePorts.get(portId);
          if (existingPort) {
            existingPort.disconnect();
          }
          const port = new WebSocketMessagePort(
            portId,
            send,
            () => messagePorts.delete(portId),
          );
          messagePorts.set(portId, port);
          return port;
        });

        dispatchPostMessage(message.channel, message.message, ports, window.id);
        return;
      }

      if (message.type === "message-port-message") {
        messagePorts.get(message.portId)?.receiveMessage(message.data);
        return;
      }

      if (message.type === "message-port-close") {
        messagePorts.get(message.portId)?.disconnect();
        return;
      }

      if (message.type === "workspace-directory-entries-request") {
        const { requestId } = message;
        getWorkspaceDirectoryEntries(message)
          .then((result) => {
            const payload: MainToRendererMessage = {
              type: "workspace-directory-entries-result",
              requestId,
              ok: true,
              result,
            };
            send(payload);
          })
          .catch((error) => {
            const payload: MainToRendererMessage = {
              type: "workspace-directory-entries-result",
              requestId,
              ok: false,
              errorMessage: errorMessage(error),
            };
            send(payload);
          });
        return;
      }

      if (message.type === "ipc-renderer-invoke") {
        const { channel, requestId, args } = message;
        const pendingKey = `${window.id}:${requestId}`;
        const first = args[0] as {type?: unknown} | undefined;
        const name = typeof first?.type === 'string' ? first.type : channel;
        pendingCalls.set(pendingKey,{name,since:Date.now()});
        Promise.resolve(
          bridgeState.handleRendererInvoke?.(channel, args, window.id) ??
            Promise.reject(
              new Error(
                `[ipc-bridge] no ipcMain.handle for channel ${channel}`,
              ),
            ),
        )
          .then((result) => {
            const payload: MainToRendererMessage = {
              type: "ipc-renderer-invoke-result",
              requestId,
              ok: true,
              result,
            };
            send(payload);
          })
          .catch((error) => {
            const payload: MainToRendererMessage = {
              type: "ipc-renderer-invoke-result",
              requestId,
              ok: false,
              errorMessage: errorMessage(error),
            };
            send(payload);
          }).finally(() => pendingCalls.delete(pendingKey));
      }
    };
    return {receive: input => {void receive(input).catch(error => console.error('[ipc-bridge] dispatch failed', error));}, dispose};
  });

  await app.listen({ host: options.host, port: options.port });
  console.log(`IPC bridge listening at ws://${options.host}:${options.port}`);

  ensureElectronLikeProcessContext();
  installModuleAliasHook();

  const packageJson = JSON.parse(
    await fs.readFile(
      path.resolve(__dirname, "../../scratch/asar/package.json"),
      "utf8",
    ),
  );

  globalThis.__CODEX_SHIM_VALUES__ = {
    version: packageJson.version,
  };

  const matches = await glob("../../scratch/asar/.vite/build/main-*.js", {
    nodir: true,
    cwd: __dirname,
  });

  if (matches.length === 0) {
    throw new Error("no main bundle found");
  }

  if (matches.length > 1) {
    throw new Error("multiple main bundles found");
  }

  const module = require(matches[0]!);
  module.runMainAppStartup();
}

async function main(args: string[]) {
  const options = parseServerArgs(args);

  await startIpcBridgeServer(options);
}

main(process.argv.slice(2));
