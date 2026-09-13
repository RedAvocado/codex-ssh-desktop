# Third-party notices

The browser transport and Electron compatibility implementation in `src/`
derive from [0xcaff/codex-web](https://github.com/0xcaff/codex-web), including
the per-view connection work in [PR 50](https://github.com/0xcaff/codex-web/pull/50),
at commit `d269fa9b22775992bb9f7333ab11bd29b9890d61`. That version declares
the MIT license in its package metadata. Its listed author is Martin.

This project adds a standalone SSH desktop client, connection configuration,
GitHub release checks, access controls, and version-checked adaptation scripts.
It includes only the adaptation path used by this project; it does not apply
upstream patches that remove CSP or bypass desktop device checks.

OpenAI's Codex application, its extracted renderer and main-process bundles,
its icons, and its bundled engine are **not distributed in this repository or
in the client release**. Setup reads the user's own installed application on
their remote Mac. Those materials remain subject to their respective terms;
this project's MIT license does not license them. Codex is an OpenAI product.
This is an independent community project, not an official OpenAI application.

The downloadable client includes Electron and Chromium. Their license notices
are included in the app's `Contents/Resources` directory. Other JavaScript
dependencies retain their own licenses in their installed packages.
