# Mobile header and desktop verification

Updated September 18, 2026.

This is the original header rollout record. The September 19 follow-up audit, expanded phone-landscape breakpoint, current tests, and current deployed hash are documented in `MOBILE-USABILITY-AUDIT.md`.

## Delivered

- At widths up to 768 px, the header contains the left drawer button, task title, and one More button. The title truncates without pushing buttons off screen; its full name is also displayed in the dropdown.
- More contains Rename task, Task options, Share, Task summary, Bottom panel, and Side panel, when the underlying controls are available. Back/Forward appear only when usable.
- These entries activate the existing controls and preserve their disabled/pressed state. They do not duplicate backend actions or move React-owned nodes.
- Phones use the shipped web task menu because the headless backend cannot display an Electron popup. The original desktop menu bridge is returned unchanged above the mobile breakpoint.
- The native rename field remains visible and usable on phones; tests cancelled editing without changing the task name.

## Desktop isolation and prior-change review

- All layout, touch, input-size, and reduced-motion overrides for native elements are confined to `max-width: 768px`. Only the adapter's own hidden elements have unconditional CSS.
- Mobile focus restrictions now save and restore prior values instead of clearing desktop values during every DOM update.
- A collapsed desktop sidebar is restored after entering and leaving phone width. Mobile-only changes no longer silently leave it expanded.
- The existing reconnect, diagnostic-log, access, and ownership tests passed. These are bounded regression checks, not proof of every possible desktop workflow. Installed native Codex/ChatGPT application bundles were not modified.

## Browser observations

- Final desktop geometry at 1280 × 720 exactly matched the pre-change measurement: sidebar 332 px, conversation area 948 px, header 46 px, all nine original header button labels and bounds unchanged, native resize handle present.
- At 769 px the original header is visible, custom header and drawer button are hidden, and the main content has no mobile `inert` restriction.
- At 320 px there is no horizontal page overflow; More remains 44 × 44 px and the title has 216 px of available width.
- At 390 px the dropdown, native web Task options, Rename field, and Task summary were opened successfully. Escape dismisses the dropdown, and opening the task drawer closes it.
- The desktop menu bridge is the original function at desktop widths and absent at phone widths so the existing web fallback is used.
- Actual iPhone Mirroring was unavailable during this update because the phone was in use. Responsive checks used the live viewer through a temporary authenticated SSH tunnel.

## Checks and deployment

- Both Macs: 41 JavaScript tests and 22 Python tests, plus viewer access checks.
- Both Macs: TLS gateway integration fixture and ownership regression checks for the prepared 26.911 runtime.
- The remote ownership harness initially looked for an old renderer name inside the independently updated installed app. It now accepts an explicit unpatched fixture; the checks passed against the prepared runtime's original renderer, with no changes to installed apps.
- Browser TypeScript and whitespace checks passed. The exact reviewed bundle was copied atomically into the remote runtime and independently fetched from the live authenticated backend.
- Deployed preload SHA256: `ace2603ee887ee00192e7ed23d1b9b304c0556c6f1e384bf25f0d466afa9be9e`.
- The Mac's direct phone-gateway request still returned 403. Phone-only access policy was unchanged.

Close and reopen the Home Screen web app once to load the new code. An already-open page is not forcibly refreshed.
