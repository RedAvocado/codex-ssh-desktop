# Startup investigation — September 18, 2026

## Result

The private viewer has additional compatibility and asset-delivery costs that normal Codex does not share. A small compatibility fix is deployed: optional native icon previews now report unavailable instead of throwing and triggering retries. In one comparable browser trace, the renderer's `app routes mounted` milestone improved from **15,960 ms to 11,897 ms** (about 25%). This is a paired observation, not a statistically controlled benchmark or a promise of identical phone performance.

Follow-up work found and fixed a separate connection failure caused by cyclic error logs (details below), and added static/connection compression. The updated interface has now visibly loaded its projects and existing conversation on the Mac and iPhone. Cold-start performance is not fully solved. Normal Codex was inspected through its existing startup logs rather than restarted during ongoing work.

## Private viewer findings

### 1. App-information request failed and retried — confirmed, fixed

The browser requested `appInfo.get()`. The shipped desktop code tries to resize optional dock-icon images. The Node compatibility layer's `nativeImage.createFromPath()` reported a nonempty image but did not implement `resize()`. This produced `TypeError: t.resize is not a function`.

In the baseline trace, failures occurred at approximately 3.76, 4.81, 6.86, and 10.91 seconds after navigation, consistent with increasing retry waits. The fix makes the headless image stub honestly report an empty image, allowing the shipped app to use its existing optional-image fallback.

After the fix, app information succeeded once at 5.15 seconds, and the trace contained **zero resize errors**. Other startup requests still overlapped this interval, so the entire retry duration cannot be counted as time saved.

Changed source: `src/server/electron/index.ts`.
Regression test: `test/native-image-startup.test.cjs`.

### 2. Account-settings/device-cookie requests fail and retry — confirmed, unresolved

The `/settings/user` request failed repeatedly with `DeviceCheck registration failed (403)` and `DeviceCheck registration returned no cookie`. Before the icon fix, these settings requests began at about 4.14, 5.27, 7.52, and 11.80 seconds. The errors remained after the icon fix.

The compatibility layer implements `net.fetch()` with Node's fetch, while its session cookie methods are stubs: reads return an empty list and writes do not retain cookies. The shipped registration code expects a cookie stored by Electron's network session. This establishes an incomplete session implementation. The observed 403 responses are an additional failure; adding cookie storage alone is not proven to resolve them.

A private in-memory cookie-store experiment did not resolve startup and was removed. No cookies were copied from the native application, and no provider/device-verification checks were disabled. The provider/session failure remains a separate limitation.

### 3. Large interface download on every reload — confirmed

One captured load fetched **266 resources / 22,800,742 transferred bytes**. The main initial JavaScript bundle alone was about 9.7 MB. At the baseline, the phone gateway served assets with `Cache-Control: no-store`, no content compression, and HTTP/1.1. This forces static interface code to be fetched again and creates request queues. Individual small chunks spent several seconds waiting behind other requests in one trace.

Implemented: gzip for static JavaScript/CSS and private caching with revalidation, including the unversioned preload. HTML, API responses, task data, and session-bearing responses remain uncached. The current preload is about 620 KB before compression and 124 KB with gzip. Gateway integration tests passed. A real cellular startup benchmark remains pending.

### Network baseline

Tailscale reached the remote host directly in roughly **37 ms**. A certificate-validated HTTPS fetch of the page returned its first byte in **154 ms**. These measurements were made from the Mac's current connection, not the phone's cellular connection. They do not support blaming the long startup pause on the SSH/Tailscale handshake.

## Normal Codex findings

The user's reported symptom is opening the app before tasks appear.

| Existing startup sample | Process-to-preload | Renderer-to-sidebar marker | Combined recorded interval |
|---|---:|---:|---:|
| Local Mac, September 18 09:37 PDT | 1.84 s | 3.40 s | 5.24 s |
| Local Mac, September 17 18:26 PDT | 3.06 s | 4.56 s | 7.62 s |
| Remote Mac, September 18 09:35 PDT | 1.31 s | 3.80 s | 5.11 s |

These are application performance markers. They do not prove that every restored task was fully hydrated at that moment.

- **Reading the task list is fast.** Across the two September 18 local startup sessions examined, `thread/list` took 1–26 ms; the current session's maximum was 6 ms. Deleting or archiving task history is not supported as a remedy by this evidence.
- **Local shell initialization has a measurable cost.** Native startup logs report 994–1,274 ms for shell environment hydration, versus 45 ms on the remote Mac's current native startup. An isolated profile of the local `.zshrc` took 1,165 ms. Inclusive function times included NVM auto initialization (390 ms), Conda activation (223 ms), and two completion initialization calls (240 ms combined). Profile times can overlap and should not simply be added. Shell configuration was left unchanged.
- **The frontend contributes several more seconds.** In the current local startup, settings were ready 1.11 seconds after preload, the shell/home appeared at 2.82 seconds, and the sidebar marker arrived at 3.40 seconds. Optimizing shell startup cannot remove all of that frontend work.
- **There are separate plugin delays.** The Affinity MCP integration timed out after 30 seconds on the local Mac, and several plugin-status calls lasted around 30 seconds. This is worth repairing, but the evidence does not establish it as the blocker for initial sidebar display. Some later task-resume operations also took 93–200 seconds; those are distinct from first showing the task list.
- **Built-in Remote attempts are failing locally.** Startup logs show attempts to enable OpenAI Remote rejected because MFA is required, taking about 1.3–1.7 seconds per reported call. They overlap other initialization; they must not be added directly to startup totals. The current remote Mac native startup showed no such errors. This installation's working phone path remains the private Tailscale gateway.
- No `resize()` or device-registration-cookie error was found in the current normal-app log examined. The private-viewer bugs should not be assumed to explain normal Codex startup.

## Actions and validation

- Applied the native-image compatibility correction in both source copies, rebuilt the remote backend, and restarted only the auxiliary viewer runtime. The normal Codex applications were not restarted.
- Before restarting, auxiliary logs showed only the already-completed connection-test turn had been started by this runtime.
- The new regression test reproduced the original `resize is not a function` failure before the fix.
- Both Macs passed **31 JavaScript tests, 22 Python tests, and viewer access checks** after the fix.
- The live private page loaded successfully after restart; backend health was ready, and the maintenance LaunchAgent was restored.
- No task history, plugins, authentication settings, shell configuration, or cache data was deleted.

## Evidence locations

Native and auxiliary log samples came from the operators' private
`~/Library/Logs/com.openai.codex/` directories. Browser evidence was collected
from an existing test task. Exact machine paths and log identifiers remain in
local records. This report preserves timings and error categories without
publishing traces, cookies, credentials, or conversation payloads.

Official troubleshooting and log-location reference: <https://learn.chatgpt.com/docs/reference/troubleshooting>.

## Follow-up: cyclic error logs blocked the control channel

The live browser exposed a repeatable JSON serialization failure in `ipc-renderer-invoke`, message type `log-message`. A third-party diagnostic error contained this cycle:

`error.diagnosticError.rawError → error`

Electron permits cyclic structured-clone objects; the JSON-based remote adapter did not. The original transport threw while logging. During reconnect work, the sequenced transport could also leave a missing sequence number and silently queue later requests behind it. This explains why a healthy backend could coexist with an empty task list and apparently connected browser.

Fixes:

- Normalize diagnostic logs into bounded JSON-safe values, preserving error names/messages/stacks and replacing cycles with `[Circular]`. Task commands and arguments retain their original semantics.
- If another unsupported message fails serialization, end the connection visibly rather than create a permanent sequence gap.
- A regression test reproduces the cyclic error and proves the next task-list request reaches the receiver.
- Ensure browser builds resolve the current shared TypeScript source instead of an older adjacent server-generated JavaScript file.

This is a private-adapter bug. It is not evidence of the same cause in native Codex.

## Follow-up: large startup state and connection recovery

One observed `statsig_evaluations` shared-state update was about 5.4 MB on the wire. The browser and host then exchange this state; compression is now negotiated for WebSocket messages, with independent compression contexts and a 32 MiB receive bound. The private gateway continues to enforce the actual phone peer before forwarding the socket.

The reconnect implementation retains a view and its MessagePorts for 10 minutes. Sequence acknowledgements prevent an already accepted request from being dispatched twice. A live SSH test kept the same browser `performance.timeOrigin` and route across forced disconnects; an unsent draft survived and was removed without submitting it. A server restart or expired view requires an explicit reopen rather than an automatic reload.

A controlled 1 MiB SSH transfer from this Mac took 12.09 seconds uploading and 2.05 seconds downloading. The observed large startup frame was 5,387,963 bytes; its gzip size was 1,275,377 bytes. These measurements explain a material cost on this Mac test path and do not establish the phone's cellular speed. After the backlog cleared, the updated Mac viewer loaded the complete project list and the existing test conversation. The real iPhone subsequently loaded an existing conversation as well. Further cold-start optimization remains possible; no fixed load-time guarantee is claimed.


## Validation after the follow-up fixes

- Both Macs passed 41 JavaScript tests, 22 Python tests, viewer access checks, the TLS gateway fixture, and current-version ownership checks.
- Browser TypeScript checks and `git diff --check` passed locally.
- The final drawer checks found native task rows use `div[role=button]`, not ordinary buttons, and the app shell has an isolated stacking context. The fix gives task rows 44-pixel targets, blocks their touch drag activation, and places the background scrim in the drawer's own stacking context so it cannot intercept task-row input.
- Hit testing then exposed another invisible blocker: a general drawer-child width rule stretched the native desktop resize handle across the whole menu. The rule now targets only the sidebar-content wrapper, and the resize-handle container is hidden on phones. A development browser check moved the drawer scroll position from 1522 to 1072 with one wheel action. The real iPhone selected the existing test task and closed its drawer correctly after deploying the fix. Mirroring scroll/drag attempts were inconclusive; physical swipe feel awaits the user's check.
- The final browser build passed on the remote runtime; local browser TypeScript and whitespace checks passed. A separate local browser bundle attempt could not run because the local source checkout has no extracted `scratch/asar/package.json`; the deployed browser artifacts are built on the remote Mac, where that extraction exists.
- Installed the **Remote Codex** Home Screen web app and verified its launch into the private viewer. Physical swipe feel remains the only mobile acceptance check not established by the automated observations. Temporary Mac testing proxies, SSH forwards, browser tab, and viewport overrides were cleaned up.
- Normal Codex binaries, its account credentials, shell initialization, and task history remain unchanged.
