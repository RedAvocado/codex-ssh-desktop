# Mobile usability audit

Updated September 19, 2026. Two independent agents reviewed mobile usability and regression risks. Their fixes and the final interactive checks are included in the deployed remote viewer.

## Fixed

- Light mode now uses the renderer's actual surface, text, border, and focus colors. The compact header and dropdown remain readable.
- The header distinguishes task titles from page titles. Plugins and Skills no longer produce a misleading Rename task action. Native links are included in the dropdown, and unsupported header forms retain their original layout.
- Keyboard Tab can traverse the dropdown. Closing native task options returns focus to the visible More button. Escape inside a project menu closes that menu first, leaving the drawer open.
- Touch events still reach nested controls while marking sortable events so DndKit does not begin dragging. Project and section menus no longer depend on mouse hover. Their controls are visible, at least 44 pixels wide, and stay inside the drawer.
- The scrim occupies only the space outside the drawer. It cannot be chosen as a close target whose center is underneath a task row.
- Drawer navigation closes on changed pages, including Plugins and project routes. Browser URLs and Back/Forward track supported renderer routes, including search/hash values, without duplicating renderer-originated history navigation.
- Compact layout covers short, touch-only phone landscape viewports up to 1024 pixels wide. Ordinary desktop pointer layouts above 768 pixels retain their native header. Rename-field offsets respect the left and right safe areas.
- A lost initial WebSocket welcome can retry without replacing its server view. Explicit unload/reload releases its abandoned view immediately. Ordinary network loss and BFCache retain resumable sessions. This fixes concrete lifecycle bugs; it does not establish that every previous loading delay had the same cause.

## Verification

- Both Macs passed 54 JavaScript tests, 22 Python tests, viewer-access checks, the TLS gateway fixture, and the prepared-runtime ownership regression fixture.
- New coverage includes route/history mapping, lost-welcome replay, explicit unload, BFCache preservation, and 20 reload cycles without exhausting the 16-session limit.
- Browser TypeScript and `git diff --check` passed after the final UI fixes.
- The live viewer at 390 × 844 loaded the existing test task without sending a new prompt. Task options, project options, focus restoration, drawer navigation, Tab traversal, light/dark colors, and browser Back/Forward were exercised.
- At 844 × 390 with coarse touch input, compact header and drawer controls remain visible with no horizontal overflow. With ordinary fine-pointer input at that width, the native desktop header is used.
- The final deployed Plugins page also passed a 320-pixel-wide check: no horizontal overflow, a 44-pixel More button, the correct page title, and a page dropdown without a Rename task entry.
- A synthetic touch pointer event reached an actual nested project-menu handler while carrying the DndKit suppression marker. An ordinary browser click also opened the now-visible project menu. Physical iPhone swipe feel was not verified during this audit because iPhone Mirroring reported that the phone was in use.
- At 1280 × 720, desktop geometry matched the preceding baseline: sidebar 332 pixels, main area 948 pixels, header 46 pixels, and all nine visible native header button labels and bounds unchanged. The collapsed sidebar preference and main-content focus state were restored after switching to and from phone width.
- The deployed backend was restarted separately from the installed native app. It loaded the existing task and retained only one live session after an explicit browser reload; there were no pending backend invokes at that check.
- Direct HTTPS from the Mac returned 403, including with a forged phone forwarded-IP header. No gateway authorization settings changed.

## Deployment

- Runtime: `~/.local/share/codex-ssh-desktop`, prepared version `26.911.61220`.
- Deployed preload SHA256: `d377dc4769c140d5f9987200a05d929032636f0162b3e4cd5ed21e9355c9755f` (636,708 bytes).
- The exact bundle was copied atomically and fetched independently from the live authenticated backend with the same hash. The prior bundle is retained in `scratch/pre-mobile-audit-preload.js`.
- Installed native Codex/ChatGPT application bundles were not modified. The remote native app has updated independently; the adapter remains on its prepared runtime.
- Temporary browser tabs, touch/viewport overrides, local test proxy, and its SSH port forward were cleaned up. No temporary test listeners remain on ports 18214 or 18420.

Close and reopen Remote Codex on the phone once to load the update. If the service restart left an existing page showing **Reopen connection**, copy any unsent draft before choosing it. Remaining cold-start costs are documented in `STARTUP-INVESTIGATION.md`.

## September 20: profile footer spacing

Added 12 pixels of bottom drawer padding in addition to the phone's safe-area
inset. At 390 × 844 and 320 × 568 with a zero reported inset, the profile button
now ends 13 pixels above the viewport edge and retains its 44-pixel touch target.
The profile popup opens fully within the 390-pixel viewport. Desktop profile,
sidebar, and content measurements at 1280 × 720 are unchanged. The browser
bundle was rebuilt and deployed without restarting the task backend.
