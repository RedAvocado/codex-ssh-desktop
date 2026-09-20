# Deep reliability and security review — 2026-09-20

The review found and fixed latent failures in startup, reconnects, native
compatibility, account operations, dictation, downloads, and the private gateway.
It also caught an analytics logging loop during live verification.

## Scope

Reviewed the repository's browser adapter and mobile controls, server and
Electron compatibility layer, reliable transport, SSH desktop client, account
helper, release installer, runtime controls, preparation patches, private HTTPS
gateway, maintenance, and supporting configuration/tests. Failure injection used
temporary files, synthetic credentials and audio, and isolated loopback servers.

The copied Codex bundles and installed engine are third-party code. Their full
implementation, macOS, Tailscale, external services, and future dependency or
application releases are outside this source review. The prepared runtime used
for live verification remains **26.911.61220**. Passing these checks is evidence
for the cases tested, not a guarantee that no other bugs exist.

## Findings and fixes

| Area | Failure found | Result after the fix |
| --- | --- | --- |
| Native confirmations | The headless Electron adapter always selected button zero, even when that button represented a destructive action. | Only an explicitly declared valid cancellation button is returned. Other native confirmations require the native app and fail with a clear message. |
| Desktop reconnect | Losing SSH navigated away from the task document and could discard an unsent draft. | Reconnecting to the same configured host preserves the current document and retries failed background connections. An explicit reload still reloads the view. |
| Account/startup coordination | Maintenance and simultaneous clients could start the auxiliary runtime during an account switch or race each other during startup. | Runtime start/stop and account operations use the same interprocess lock. The account worker can reconnect while retaining its lock. No real account switch was performed for this review. |
| Gateway startup | A missing or malformed backend token could throw out of HTTP or WebSocket request handling. | The gateway returns a recoverable 503 and remains available for later requests. |
| Interrupted transfers | Interrupted upstream HTML or downloads could leave responses hanging; disconnect cleanup was incomplete in the gateway and outbound proxy. | Upstream errors terminate the response, abandoned requests are cleaned up, and connection/response inactivity is bounded. |
| Renderer startup | A factory exception, asynchronous initialization failure, or synchronous startup queue overflow could strand a welcomed session or escape its socket handler. | The failed session resets explicitly, disposes its view, and releases its capacity. Initialization also has a deadline. |
| Task ownership | A timeout did not cover awaited owner-discovery and notification calls. A real owner snapshot could arrive while attachment still waited forever. | One deadline covers the operation. A real snapshot can complete attachment independently of its notification acknowledgement. Failed attachment releases its temporary following state. |
| Terminal disconnect | Pending browser requests and transferred ports survived a terminal session reset. | Pending calls reject with a useful error, ports close, and future calls reject immediately. Transient reconnects continue to preserve queued work. |
| Event/window lifecycle | Removing an original `once` listener did not remove its wrapper; newly added listeners ran during the same dispatch; window close ignored cancellation. | Server events use Node's emitter semantics, browser dispatch snapshots its listeners and supports removing `once` handlers, and cancellable window close is respected. |
| Dictation recovery | Failure to remove a temporary recording left the transcriber permanently busy. | The concurrency slot is released even when cleanup fails. A later recording can proceed. |
| Account metadata | Invalid token timestamps could break the whole account catalog, especially when comparing duplicate captures. | Malformed timestamps, including non-finite and overflowing values, are rejected within the per-profile validation boundary. Valid accounts remain available. |
| Update download | A failed exclusive file creation could enter cleanup and delete a destination it did not create. | Cleanup owns a file only after successfully creating it. Existing archives survive an `EEXIST` failure. |
| Gateway configuration | An omitted or wildcard bind address could unintentionally create a broad listener. | Startup requires an explicit non-wildcard IP, an HTTPS origin, and a nonempty device-address allowlist. IPv6 wildcard spellings are covered. |
| Compression | `gzip;q=0` was treated as accepting gzip. | Explicit quality values and wildcard fallback are respected. |
| Analytics | The copied renderer repeatedly attempted optional analytics requests, received 403 responses, and generated large diagnostic batches. | The supported 26.911 renderer disables analytics logging/storage and guards the analytics and SDK-exception endpoints. Feature-configuration traffic remains available. |

The analytics setting uses the SDK's supported `loggingEnabled: 'disabled'`
option. The narrow network guard also covers batches queued before the opt-out
takes effect. See [Statsig's JavaScript SDK options](https://docs.statsig.com/client/javascript-sdk).

## Verification

- **87 JavaScript tests and 24 Python tests**, plus the existing access checks.
- **Five isolated HTTPS gateway tests**, including missing tokens for HTTP and
  WebSocket upgrades, interrupted HTML/downloads, same-origin requirements,
  session cookies, cache policy, and compression negotiation.
- Browser TypeScript validation and a production browser build against a copy
  of the prepared 26.911 runtime.
- Ownership regression checks against the actual unpatched 26.911 renderer:
  writer conflicts, follower attachment, cancellation, missing snapshots, and
  patch drift guards.
- Live backend authentication and origin checks; outbound proxy authentication
  and HTTPS CONNECT with certificate verification.
- Live private HTTPS dictation: a synthetic 2.4-second phrase was transcribed
  successfully with HTTP 200. The first synthetic file was empty because the
  test generator lacked macOS speech-service access; a verified nonempty file
  passed. This was not a physical iPhone microphone test.
- Browser layout checks at **390 × 844**, **320 × 568**, and **1280 × 720**.
  No horizontal overflow; the phone drawer button remained 44 pixels wide at
  the far left; the profile button retained 13 pixels of bottom clearance; its
  popup fit the 320-pixel viewport. Desktop retained its 30-pixel profile button
  and original placement.
- The updated installed SSH desktop client opened and connected successfully.
  Its bundle passed identity, version, architecture, code-signature, and symlink
  validation before installation.
- A fresh browser session opened the existing task with no captured warnings
  or errors after the final analytics guard was deployed. The SDK instance
  reported logging disabled; no account data was exposed by that check.
- `npm audit --audit-level=high`: **0 reported vulnerabilities** at review time.

## Deployment and practical limits

The auxiliary viewer was idle before its restart. Source and prepared-file
backups were retained. The native Codex application kept the same process, and
the active account file, backend token, TLS key, phone session, and device
allowlist were verified unchanged during deployment. Remote source differences
were checked against the reviewed base; existing main-branch native-icon,
Browser-plugin-path, and web-menu compatibility fixes were included.

The supported renderer preparation now includes the analytics opt-out. Updating
only `preload.js` cannot apply a change inside the copied renderer; follow the
staged update procedure in [PHONE-SETUP.md](PHONE-SETUP.md).

An already-open page keeps its JavaScript until reloaded. Save any unsent draft
and reopen the phone web app to receive the complete update. Native confirmations
that cannot be presented safely still require the native app on the remote Mac.
The client updater and remote installation should be updated together when
adopting the new account-operation locking protocol; an older client may require
a manual reconnect after an account switch.

The device restriction protects this gateway. It does not change existing SSH
access or tailnet administrator powers. Normal Codex prompts, model requests,
and feature configuration still use the configured provider. Local dictation
and private device transport do not make the entire Codex service offline.
