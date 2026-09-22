# Computer switching verification

Verified on September 22, 2026, with two owner-operated Apple Silicon Macs,
private Tailscale HTTPS gateways, and prepared desktop version `26.911.61220`.

## Behavior

- A small computer-name menu sits above the existing mobile or desktop viewer.
- Availability requires the selected gateway's authenticated loopback backend
  to report ready. Offline destinations are hidden. An already selected offline
  view remains available for copying a draft and switching to another Mac.
- Each computer gets its own retained frame and origin. Switching reuses it;
  it does not reload the renderer, transfer its credential, or send its draft.
- Task links and per-computer navigation survive reload. Explicit task links
  take precedence over a computer or task saved earlier in the browser session.
- Polling unchanged status keeps menu controls stable. Failed status requests
  show unknown availability instead of claiming that a connected viewer is offline.

## Automated checks

- `npm test`: 99 JavaScript tests, 24 Python tests, and viewer access checks pass.
- Browser adapter TypeScript check passes; production preload build succeeds.
- `node --test test/phone-gateway.integration.cjs`: 7 HTTPS integration tests pass.
- Runtime dependency audit: no reported vulnerabilities.

New regression checks cover independent retained views, offline removal, a
destination failing during selection, a current view going offline, unchanged
polls, unavailable discovery, deep-link precedence, reload restoration, and
route messages with the wrong origin or frame identity. Gateway tests also
check that the switcher remains available when its task backend is down and
that an explicitly pinned probe IP does not bypass TLS hostname verification.

## Live verification

- Both computers reported ready and displayed their own project/task lists.
- Typed different synthetic unsent drafts on each Mac, switched in both
  directions, and confirmed the drafts remained separate. Removed both test
  drafts afterward; no test prompt was submitted.
- Temporarily stopped only the second Mac's HTTPS gateway with an automatic
  restore deadline. Its menu choice disappeared and returned after restoration.
  Its retained draft also survived the gateway reconnect.
- Opened an existing task link and reloaded it; the same computer and task
  remained selected.
- Checked the interface at desktop and phone widths. The native desktop
  application and the original SSH client bundle were not changed.
- Verified local speech-to-text on the new Mac using a synthetic audio fixture.
- Compared the deployed gateway, shell, browser source, and built preload hashes
  on both Macs with the tested working copy. The pre-existing remote task
  backend retained its process ID during deployment.

## Limits

Physical iPhone/Home Screen interaction was not exercised in this verification
because iPhone Mirroring reported that the Mac was locked. The phone-sized
browser checks do not establish Safari keyboard, permission, or hardware
microphone behavior. The frame permits microphone access, and the private
transcription endpoint passed the live fixture check.

A Mac must remain awake, signed in, and on Tailscale. Opening a Home Screen
icon still requires the gateway named in that icon's URL. Keep the other
computer's direct URL as a fallback. Closing or reloading the whole app can
discard unsent drafts even though ordinary computer switching preserves them.
See [setup, privacy, and operating instructions](PHONE-SETUP.md#switch-between-your-computers).

### Keyboard spacing follow-up

The phone shell now uses half of the bottom safe-area inset with a black
background, and the drawer's added footer padding is 6px instead of 12px.
When an unzoomed touch viewport shrinks for the keyboard, the outer shell fits
that visible area and removes its bottom inset. Closing the keyboard restores
the smaller inset. Pinch zoom and desktop resizing do not trigger this layout.

Verified in an isolated browser tab with a 34px emulated bottom safe area:
17px black padding when closed, 0px padding and a 510px shell with simulated
keyboard viewport metrics, and 17px after dismissal. Desktop returned to
static positioning, 0px padding, and its original background. The two added
regression tests cover viewport resize/scroll/dismissal and exclusion of
browser chrome, zoom, and desktop changes. Physical iPhone keyboard behavior
remains unverified because iPhone Mirroring reported that the Mac was locked.
