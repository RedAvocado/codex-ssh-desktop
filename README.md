# Codex SSH Desktop

A separate macOS app that brings the Codex desktop interface to your computer
while commands, files, tools, and the Codex account stay on your remote Mac.
The interface renders locally; the connection uses your existing SSH alias.

**Experimental 0.3 release.** Built from the community `codex-web` bridge.
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
- **Accounts → Manage Accounts…** reads local and remote Codex Vitals profiles,
  copies a local login over SSH, and switches the remote Codex account after
  confirming that all remote Codex tasks will stop.

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
git checkout v0.3.0
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

## Accounts and Codex Vitals

Open **Accounts → Manage Accounts…** (⇧⌘A). Each account appears once, with an
indicator showing whether it is available locally, remotely, or on both Macs.
The list combines Vitals profiles, previously copied accounts, and the active
Codex login. Copy and Switch controls stay together on the account's row.
Distinct workspace identities remain separate even if they share an email.
Once loaded, remote accounts are also available directly in the Accounts menu.

Each row shows **percent remaining** and **reset dates** for the quota windows
Vitals reports, such as weekly or five-hour limits. The newest successful Vitals
snapshot available on either Mac is used for that account. The source and last
update time appear below the reading, and reset dates use the local Mac's time
zone. The page re-reads snapshots every minute while visible and when you click
Refresh. Refresh inside Vitals to fetch a new reading from OpenAI. Missing or
failed readings are shown as unavailable; a passed reset is marked as needing
a refresh rather than assuming the account is full again.

- **Copy to remote** sends the selected account's access, refresh, and ID tokens
  over SSH into a private account store. It does not activate the account or
  stop tasks. Existing saved credentials are backed up; older credentials are
  refused when a newer remote copy exists.
- **Switch** always asks for confirmation. It backs up the active login, stops
  this user's remote Codex app, engines, task subprocesses, and auxiliary viewer
  runtime, installs the selected credentials, and relaunches the remote app.
  The viewer then reconnects. **Stopped tasks must be resumed manually.**

If you copy a newer login for the already active remote account, **Apply login**
uses the same confirmed restart flow to activate those new credentials.

Python 3 must be available at `/usr/bin/python3` on both Macs. No new OpenAI
login is needed locally. Existing remote viewer installations can use these
controls without rebuilding their copied desktop runtime: the client installs
a small Python helper over SSH when the account list is opened.

Vitals files are read from `~/Library/Application Support/CodexVitals/` without
modifying Vitals or its accounts database. Copies, outgoing account snapshots,
private backups, and operation status are stored remotely under
`~/.local/share/codex-ssh-desktop/accounts/`. Credential files use mode `600` and
private directories use mode `700`. Tokens travel through process stdin and
never enter the Accounts renderer, command arguments, or application logs.

The account worker continues if SSH disconnects. The client remembers a pending
switch and checks its status before reconnecting. If activation fails after
the credential change, it attempts to restore the previous account and relaunch
Codex. If recovery itself fails, the Accounts window keeps the viewer disconnected
and provides status and recovery controls. Account switching interrupts work;
automatic credential rollback cannot resume that work.

Only complete desktop OAuth profiles are supported. Capture incomplete accounts
again in Vitals. A copied credential file is not proof of a valid login: Codex
checks the login when it uses the account. Sharing a refresh-token pair between
Macs can require a fresh login if one copy is rotated or invalidated. Capture
fresh credentials in Vitals and copy again if this happens. Do not run another
account switch or reopen a remote Codex client while a switch is in progress.

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

Native Electron dialogs, embedded browser tabs, notifications,
and complete computer-use parity need further verification or compatibility
work. Task ownership and Resume Goal have targeted code tests, but complete
live parity with the native app is not established. Queued-message deletion
has passed isolated coordinator tests; an intermittent UI report remains
unresolved. Some desktop integrity and telemetry requests can return HTTP 403.

Account switching has synthetic credential, process, rollback, SSH-hangup, and
Electron UI tests. Live Vitals catalog discovery and process preflight have been
checked on macOS. A real account was not activated during development because
the remote Mac had ongoing work; successful file activation and app relaunch
do not by themselves establish that OpenAI accepts a saved refresh token.

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
npm run test:accounts-ui
npm start
npm run package:mac
```

`npm test` runs the TypeScript build, connection/update/account tests, Python
account recovery tests, and access checks. `test:accounts-ui` runs an isolated
Electron window with synthetic accounts; it does not connect over SSH or read
real credentials. It requires a graphical desktop.
`npm run test:desktop` additionally requires a prepared supported application
and exercises its actual copied coordinator code with synthetic messages.
Packaging includes the client shell and Electron, excluding the copied Codex
bundles, remote runtime, connection settings, and logs.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution
and the distinction between this project's code and OpenAI's application.
