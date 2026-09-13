# Codex SSH Desktop

A separate macOS app that brings the Codex desktop interface to your computer
while commands, files, tools, and the Codex account stay on your remote Mac.
The interface renders locally; the connection uses your existing SSH alias.

**Experimental 0.1 release.** Built from the community `codex-web` bridge.
This is an independent project from DittoDub, not an official OpenAI app.

[Download for macOS](https://github.com/RedAvocado/codex-ssh-desktop/releases/latest)
· [Report an issue](https://github.com/RedAvocado/codex-ssh-desktop/issues)

## What you get

- A separate app, profile, and connection settings.
- SSH transport with automatic reconnection.
- Your existing remote Codex login, task history, and projects.
- Remote file previews and external links opened in Chrome on the remote Mac.
- **Codex SSH Desktop → Check for Updates…** checks GitHub releases and opens
  the download page when a newer client version is available.

The update checker is manual. It does not replace the client, update the remote
Codex application, or restart running work. Checks go to GitHub from your local
computer and do not include your SSH configuration or Codex credentials.

## Compatibility

The adaptation scripts currently support **Codex desktop 26.903.61454** on a
remote Mac. Setup rejects other versions before replacing an existing build.
Newer Codex builds need updated compatibility patches, even if the client app
itself is current. Do not downgrade a machine with active work to try this.

The download is an Apple Silicon macOS client. An Intel client can be built
from source on an Intel Mac. The release is ad hoc signed, not Apple notarized;
macOS may require you to allow it through Privacy & Security after opening it.

## Set up the remote Mac

Requirements: an existing SSH connection, a supported installed Codex desktop
app with its existing login, Node.js 24 or later, Git, and command line build
tools for native dependencies. The native Codex app can remain running.

Run these commands **on the remote Mac**:

```sh
git clone https://github.com/RedAvocado/codex-ssh-desktop.git \
  ~/.local/share/codex-ssh-desktop
cd ~/.local/share/codex-ssh-desktop
git checkout v0.1.0
npm ci
npm run prepare:desktop -- /Applications/ChatGPT.app
npm run build:browser
npm run build:server
npm run test:desktop
```

If your app is installed as `/Applications/Codex.app`, pass that path instead.
Setup copies and patches files inside this project's ignored `scratch/`
directory. It does not modify the installed OpenAI application bundle.

## Connect from your computer

1. Download and unzip the client, then move **Codex SSH Desktop.app** into
   Applications. Or run `npm ci` and `npm start` from a source checkout.
2. Open the app and enter the SSH alias you already use, such as `studio`.
3. Select **Save and connect**. For a different remote install path or Node
   executable, expand **Advanced connection settings**.

Configure SSH keys, ports, jump hosts, and keepalive preferences in
`~/.ssh/config`. Verify `ssh studio` works first; the app uses noninteractive
SSH and respects that configuration. A new OpenAI login on the local Mac is
not needed.

Connection settings are stored locally in
`~/Library/Application Support/Codex SSH Desktop/connection.json`.
They are not part of the repository or the downloadable app. The connection
log is `viewer.log` in the same directory.

The client uses local ports **18214/18215**, forwarding to **18314/18315** on
the remote loopback interface. Only one viewer can use these local ports at a
time. The auxiliary host binds to loopback and requires a private session token.

## How it works

```text
Local macOS client       SSH tunnel          Remote Mac
┌───────────────────┐                       ┌─────────────────────────┐
│ Codex interface   │ ← events + requests → │ Auxiliary desktop host  │
│ rendered locally  │                       │ Codex engine and tools  │
└───────────────────┘                       └─────────────────────────┘
```

The remote component runs a **second desktop runtime**, using a compatibility
layer and a copy of the installed app's code. It starts an additional Codex
backend process and shares the remote user's `.codex` data. Normal task and
settings actions can therefore change the same data used by the native app.

For a task owned by the native app, the viewer discovers that owner and uses
the desktop's follower protocol where supported. It does not delete writer
locks or claim ownership after a rejected resume. It is not a direct mirror
of the original native window.

Closing the client disconnects SSH and leaves the auxiliary host running.
Desktop tools that depend on a connected renderer may become unavailable until
you reconnect. Survival of an actively streaming turn across every reconnect
scenario is not yet verified.

## Current limits

Native Electron dialogs, embedded browser tabs, notifications, account switching,
and complete computer-use parity need further verification or compatibility
work. Task ownership and Resume Goal have targeted code tests, but complete
live parity with the native app is not established. Queued-message deletion
has passed isolated coordinator tests; an intermittent UI report remains
unresolved. Some desktop integrity and telemetry requests can return HTTP 403.

## Operations and development

On the remote Mac, inspect the auxiliary host without printing credentials:

```sh
cd ~/.local/share/codex-ssh-desktop
node desktop/control.cjs status
```

Only after its tasks are idle, stop this project's auxiliary runtime explicitly:

```sh
node desktop/control.cjs stop
```

This command checks the recorded PID before stopping it. It does not stop the
native Codex app. `ensure` is used internally by the client and emits a private
connection token; do not paste its output into issues or logs.

Local client development and packaging:

```sh
npm ci
npm test
npm start
npm run package:mac
```

`npm test` runs the TypeScript build, connection/update tests, and access checks.
`npm run test:desktop` additionally requires a prepared supported application
and exercises its actual copied coordinator code with synthetic messages.
Packaging includes the client shell and Electron, excluding the copied Codex
bundles, remote runtime, connection settings, and logs.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution
and the distinction between this project's code and OpenAI's application.
