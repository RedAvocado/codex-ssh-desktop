# Use Remote Codex on an iPhone

Remote Codex is a Home Screen web app served by your own remote Mac over
Tailscale. The icon opens that private website in its own window. There is no
App Store package to install or update.

## Add the icon to your Home Screen

This assumes the remote Mac's HTTPS phone gateway is already configured as
described below and your phone is on its device allowlist.

1. Connect Tailscale on the iPhone to the same tailnet as the remote Mac.
2. Open **Safari** and visit your gateway address, for example
   `https://your-mac.your-tailnet.ts.net:8443/`. Use your own configured address.
3. Confirm that the viewer opens and shows your projects. If it says the viewer
   is restricted to configured devices, the operator must add this phone's
   Tailscale address to the gateway allowlist first.
4. Open Safari's **Share** menu and choose **Add to Home Screen**.
5. Name it **Remote Codex**, leave **Open as Web App** enabled if shown, and tap
   **Add**.
6. Open the new icon to verify it works. Keep Tailscale connected when using it.

The remote Mac must stay powered on, awake, signed in, and connected to
Tailscale and the internet. Your local laptop can be closed. After the remote
Mac restarts, its login session must start again; FileVault startup unlock may
require access to that Mac.

## Use it

- If multiple computers are configured, tap the computer name at the top and
  choose an online Mac. Each Mac has its own tasks, projects, files, and account.
  Switching keeps both views open, including unsent drafts. A full app close or
  reload can still discard unsent input, so save important drafts first.
- **☰** on the far left opens the project/task drawer. Swipe within the drawer
  to scroll, then tap a task to open it and close the drawer.
- The phone header shows the page or task name. **•••** contains the available
  task options and panel controls.
- With local dictation configured, tap **Dictate**, allow microphone access,
  speak, and tap **Stop dictation**. Review the text before sending it.
  **Transcribe and send** is a separate action that submits the resulting text.
- Keep each recording under five minutes and 16 MB. If the remote Mac is busy
  transcribing another recording, try again after it finishes.
- Brief network interruptions can resume the same page for up to ten minutes.
  If **Reopen connection** appears, copy any unsent text before choosing it.

Mobile layout changes apply at phone widths and short touch-only landscape
sizes. Ordinary desktop layouts retain their full header and sidebar. Both
sizes use the shipped web context menus because the auxiliary host cannot
display native Electron popups.

## Switch between your computers

The optional computer menu keeps all of your viewers inside the same Home
Screen app. Your phone connects directly to each selected Mac's private HTTPS
gateway over Tailscale. The starting gateway only serves the small switcher
and checks availability; it does not proxy the other Mac's conversations or
copy its Codex credentials. No cloud relay or public tunnel is added.

Only computers whose gateway and task backend report ready are offered as
switch destinations. Availability refreshes every 15 seconds while the app is
visible and again when opening the menu or switching (server checks can be
cached for two seconds). **Check again** requests a fresh client check. A Mac
that goes offline while selected stays visible with an Offline label, so you
can copy its draft or choose another online computer. A failure to reach the
starting gateway is labeled Availability unknown. The app does not move or
resubmit your work to another host.

The selected computer and each computer's last page are remembered for the
browser session. Computer views are separate frames with separate origins,
cookies, task navigation, and draft state. The existing desktop SSH client
keeps its original interface; the private browser viewer adds only the small
computer bar above its existing desktop or mobile layout.

### Configure a second Mac

1. Install and prepare a supported auxiliary viewer and private phone gateway
   on the second Mac. Each Mac uses its own Codex login, `runtime/` secrets,
   TLS certificate, and loopback backend. Do not copy an account store,
   `viewer-token`, `phone-session`, or TLS private key between computers.
2. Add your phone and own viewing computers to each gateway's exact
   `allowedPeers` list. Also allow the other configured gateway's Tailscale
   address so it can perform readiness checks. This trusts that owner-operated
   device for viewer access; it does not authorize the entire tailnet.
3. Give both gateways the same `computers` list and allow the other gateway as
   a frame ancestor. Keep all gateways on the same Tailscale DNS suffix so
   Safari treats the framed viewers as same-site and can use their private
   cookies. Certificates must be valid for each gateway's DNS hostname.

For example, extend the studio Mac's private `phone-config.json`:

```json
{
  "origin": "https://studio.your-tailnet.ts.net:8443",
  "bindAddress": "100.64.0.10",
  "allowedPeers": ["100.64.0.20", "100.64.0.30"],
  "frameAncestors": ["https://laptop.your-tailnet.ts.net:8443"],
  "computers": [
    {
      "id": "studio",
      "name": "Studio Mac",
      "origin": "https://studio.your-tailnet.ts.net:8443",
      "probeAddress": "100.64.0.10"
    },
    {
      "id": "laptop",
      "name": "Laptop",
      "origin": "https://laptop.your-tailnet.ts.net:8443",
      "probeAddress": "100.64.0.30"
    }
  ]
}
```

On the laptop, use its own origin and bind address, put the studio address and
your phone in its allowlist, and put the studio origin in `frameAncestors`.
IDs and origins must be unique, names must be nonempty, and the list must
include the gateway serving it. At most eight computers are supported.
`probeAddress` is an optional fixed Tailscale IP for host-to-host checks when
MagicDNS is unavailable on a Mac. It preserves TLS hostname and certificate
validation; it does not change the phone's destination or disable HTTPS checks.

4. Deploy the browser preload built from the same revision on both Macs, along
   with `phone-gateway.cjs`, `phone-computers.cjs`, and the `phone-shell.*` files.
   Restart the affected gateways, preserving their existing session files.
5. Confirm that both `/__phone/health` endpoints return `{"ready":true}` from
   an allowed device, then open the normal gateway URL and exercise the menu.
   Test a draft on each computer, offline removal, reconnect, and a reload.
6. Reload the existing phone app to get the new switcher. The Home Screen icon
   and original URL stay the same.

A Mac is available only while awake, signed in, and connected. Closing a
laptop may make it unavailable unless it is already configured to stay awake.
The gateway whose URL the Home Screen icon opens must itself be reachable to
start that app. Keep the other Mac's direct URL as a fallback; both gateways
can show the same computer menu. An already-open view of the other Mac can
remain usable when the starting gateway disappears, but its menu cannot check
new destinations until the starting gateway returns.

## How updates reach the phone

| Change | How it reaches you |
| --- | --- |
| A new viewer build is deployed on the remote Mac | Reload the page or fully close and reopen the Home Screen web app. The icon stays installed. |
| A commit is pushed to GitHub `main` | The source is published. **This does not deploy it to the remote Mac.** |
| A macOS client release is published on GitHub | In Codex SSH Desktop on your local Mac, choose **Check for Updates…**, download it, then choose **Install and Restart**. This updates the client shell. |
| The native Codex/ChatGPT application updates | The prepared auxiliary runtime remains on its copied version. A newer native version may need new compatibility patches before the bridge can be prepared again. |

**There is no automatic GitHub-push deployment service in this repository.**
The phone maintenance job checks runtime health and renews the HTTPS
certificate; it does not pull Git, build new code, or install releases.
Runtime startup uses the same interprocess lock as account switching, so
maintenance cannot restart the auxiliary host during a credential change.
GitHub CI checks source changes and the packaging workflow builds a macOS
client on request. Neither workflow connects to your remote Mac.

Static scripts and styles use private caching with revalidation. HTML, API
responses, and task data use `no-store`. An already-open page keeps its loaded
JavaScript until reloaded; it is not forcibly refreshed when files change.

### Operator update procedure

1. Finish active work before any auxiliary-backend restart. Preserve unsent
   drafts and back up the working source and prepared `scratch/asar` build.
2. Fetch and review the desired GitHub revision. Commit or preserve local work
   before integrating it. Keep `runtime/` and its existing credentials,
   certificates, allowlist, and transcription model intact.
3. Run `npm ci` if dependencies changed, `npm test`, the browser TypeScript
   check below, and `node --test test/phone-gateway.integration.cjs`.
4. Build the browser with `npm run build:browser` against the supported prepared
   extraction. The build writes into `scratch/asar/webview/assets`, so use a
   staging copy for a live installation. `npm test` also builds the server.
5. Changes to `desktop/*-patch.mjs` require a newly prepared compatible
   extraction or an explicitly reviewed migration. Rebuilding the browser
   preload alone does not apply renderer or host patches. Do not blindly run
   `prepare:desktop` against a newer unsupported installed application.
6. Deploy the tested files, restarting only the affected service when its work
   is idle. Suspend the maintenance job while deliberately stopping or
   replacing the auxiliary backend, since maintenance otherwise starts it.
7. Check `node desktop/control.cjs status`, HTTPS access from an allowed device,
   denied access from an unlisted device, and the actual viewer. Compare the
   deployed asset hash with the tested artifact. Restore the previous files
   if verification fails. Re-enable maintenance after the runtime is healthy.
8. Reload Remote Codex on the phone to load the deployed interface.

Browser type check:

```sh
npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler \
  --jsx react-jsx --skipLibCheck --types vite/client src/browser/shim.ts
```

Publishing a commit, deploying a build, and installing a macOS release are
separate steps. A successful GitHub push is not evidence of a running deployment.

## Remote gateway configuration reference

The gateway is an optional, operator-configured adaptation. Complete the
[remote Mac prerequisites and preparation](README.md#set-up-the-remote-mac)
first. Node 24+, Tailscale with HTTPS certificates, and a supported prepared
desktop version are required. Serve/Funnel and a public tunnel are unnecessary.

Create the following **private, untracked** files in `runtime/` on the remote
Mac. Use directory mode `0700` and configuration/key mode `0600`.

`runtime/phone-config.json` (replace all examples with your own device values):

```json
{
  "origin": "https://your-mac.your-tailnet.ts.net:8443",
  "bindAddress": "100.64.0.10",
  "allowedPeers": ["100.64.0.20", "100.64.0.30"]
}
```

`bindAddress` is the remote Mac's Tailscale address. `allowedPeers` is the exact
list of client device addresses allowed to open the viewer: for example, your
phone and your laptop. Include IPv6 addresses if used by your setup. Do not
replace the allowlist with the whole tailnet. Obtain these addresses from
Tailscale's device information; the example values above are not your devices.

The gateway reads `runtime/phone.crt` and `runtime/phone.key`, issued for the
configured origin's hostname through `tailscale cert`. It uses the existing
backend's `runtime/viewer-token` internally, creates its own private
`runtime/phone-session`, and never sends the backend token to the browser.

Run the following entry points under the remote user's login session, using
the same Node 24+ executable and repository working directory:

- `desktop/phone-gateway.cjs`: persistent HTTPS service, with a LaunchAgent
  configured to keep it alive.
- `desktop/phone-maintenance.cjs`: run at login and every 60 seconds. It checks
  the auxiliary runtime and renews the certificate when expiry is near. Its
  current Tailscale executable path assumes `/Applications/Tailscale.app`.

Route stdout/stderr to private files under `runtime/`, set the LaunchAgents'
umask to `077`, and use absolute executable and repository paths. These are
user LaunchAgents; they do not run before login. The existing installation's
machine-specific runbook should record its service labels and paths.

### Add a phone alongside an older running backend

When the original unsequenced backend owns active tasks, deploy the phone
gateway in a separate directory instead of restarting that backend. Set
`legacyBackend: true` and `backendSessionCookie` to the existing backend's
cookie name (the original BBW installation uses `bbw_session`) in the private
phone configuration.

Copy the running installation's prepared `scratch/asar` extraction into the
gateway directory, then build the current server and browser there. The
gateway serves that matching extraction's new mobile preload while forwarding
the other assets to the original backend on loopback port 18314. Link the
gateway's private `runtime/viewer-token` to the original token file so token
rotation continues to apply. Keep tokens and both directories private.

The adapter retains the original backend view across brief phone disconnects,
deduplicates repeated phone messages, and replays missed responses. If the
backend connection itself fails, it requests **Reopen connection**; it cannot
restore an old backend view after that connection is lost.

Keep maintenance pointed at the **original** runtime's control entry point.
Do not run the default `desktop/phone-maintenance.cjs` from the sidecar, because
its startup check would target the replacement runtime. Use a private copy
with the original absolute control path and working directory, retaining the
certificate renewal logic for the gateway's own certificate files. Record
those paths and LaunchAgent labels in the ignored machine runbook.

### Optional local dictation

Install FFmpeg and `whisper.cpp` on the remote Mac and obtain a compatible
Whisper model from the upstream distribution. Verify the model's published
checksum. The tested setup used whisper.cpp 1.9.4 and multilingual Whisper
small; see [dictation verification](DICTATION-VERIFICATION.md).

Create `runtime/transcription-config.json` with absolute paths:

```json
{
  "whisper": "/opt/homebrew/bin/whisper-cli",
  "ffmpeg": "/opt/homebrew/bin/ffmpeg",
  "model": "/absolute/path/to/runtime/models/ggml-small.bin"
}
```

The Homebrew paths above are examples for Apple Silicon. The local dictation
renderer patch is supported for prepared desktop version `26.911.61220`.
Temporary recordings are private and removed after transcription or failure.
There is no external transcription fallback for this path. Sending the
resulting prompt still sends normal task context to the configured AI provider.

## Privacy boundaries

- The viewer travels between authorized devices and the remote Mac over
  Tailscale, with certificate-validated HTTPS. Tailscale may carry encrypted
  traffic through its relay infrastructure.
- Gateway authorization checks the actual socket peer. Forwarded-IP headers
  do not authorize a different device. Cross-origin mutations are rejected.
- This gateway allowlist does not change SSH access, other services on the Mac,
  or tailnet administrator powers.
- Codex's AI requests, enabled tools, plugins, and telemetry retain their normal
  provider connections. This is not an offline system.
- Never commit device configuration, tokens, certificates/private keys, models,
  logs, recordings, extracted application code, or account stores. Keep personal
  addresses and operating instructions in the ignored `PRIVATE-SETUP.md`.
