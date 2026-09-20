# Remote browser dictation repair

September 20, 2026.

## Failure found

Four composer dictation failures in the auxiliary runtime log contained an HTML Cloudflare challenge for `/backend-api/transcribe`, with HTTP 403. The original adapter therefore did not receive a transcription result. This evidence points to the transcription service request; it does not prove the microphone was malfunctioning or establish the same cause for unrelated native-app voice issues.

## Change

- Installed Homebrew `whisper.cpp` 1.9.4 on the remote M1 Pro, using the existing FFmpeg installation.
- Downloaded the multilingual Whisper small model (487,601,967 bytes) from the upstream model distribution and verified its published SHA1 `55356645c2b361a969dfd0ef2c5a50d530afd8d5`.
- The extracted browser renderer now sends dictation to `/__backend/transcribe` on the existing private viewer origin. The gateway handles it in-process after its existing socket-peer, HTTPS, origin, and session checks. No new TCP listener or credentials were created.
- The browser adapter disables external dictation streaming and AI text cleanup for this local path. It does not upload a failed local recording to another transcription service.
- FFmpeg converts browser audio to mono 16 kHz PCM, and Whisper returns the transcript. Temporary work directories are private and removed on success, failure, or cancellation. Process output is not copied into logs or error responses.
- Uploads are limited to 16 MB, decoded recordings to five minutes, and processing to one simultaneous recording and a two-minute deadline. FFmpeg accepts only local file/pipe protocols.
- Only the private gateway was restarted. The task backend remained PID 34284 throughout deployment. Installed native applications were not modified.

The browser flow is verified on the private HTTPS URL. A matching route is also included in the auxiliary backend source/compiled code for the SSH desktop viewer; that backend was deliberately not restarted during this repair, so its new route takes effect on its next normal restart and that desktop-app route is not part of the live proof below.

## Verification

- Both Macs: 60 JavaScript tests and 22 Python tests passed, plus access, ownership, and TLS-gateway integration checks. After adding in-process gateway routing, the six transcription checks and gateway integration fixture passed again on both Macs.
- Covered private temp-file cleanup, conversion limits, malformed/oversized input, unavailable configuration, cancellation, busy rejection, same-origin upload checks, CSRF rejection, renderer patch drift, and disabling external streaming/cleanup.
- Live authenticated HTTPS uploads of the same synthetic speech in WebM/Opus and M4A/AAC returned HTTP 200 and the expected sentence in 4.04 and 4.35 seconds respectively. The first-ever model run required initialization; the subsequent direct model benchmark was 1.15 seconds for 4.74 seconds of audio.
- Live UI test used the real Dictate and Stop dictation buttons with a generated speech stream substituted for the physical microphone only in a temporary test tab. MediaRecorder captured it, and the composer received: “The remote microphone test is working. Please put this sentence into the message box.”
- The recorded browser fetch for this action was `/__backend/transcribe`. No new prompt was sent. The test draft, temporary microphone override, audio context, and test tab were removed afterward.
- Physical iPhone microphone/permission behavior was not exercised. M4A codec acceptance and the deployed browser flow are verified separately.

## Deployment and use

Remote root: `~/.local/share/codex-ssh-desktop`.

Private configuration: `runtime/transcription-config.json` (mode 0600). Model: `runtime/models/ggml-small.bin`. Temporary audio: `runtime/transcription-tmp`, empty after completed checks.

- Preload SHA256: `e7787240740a045e7b48ca0f42b2c9461dc63d8fe278a6393b5a1ae79a6f3849`.
- Patched `app-initial-b21bd554b363.js` SHA256: `7a37e55dd96018249185832b07321a6598b51460ec3a2f8673836d095fae556b`.
- Previous browser assets retained in `scratch/pre-local-dictation`.
- `desktop/prepare.mjs` applies the dictation patch to the supported 26.911 extraction and fails on incompatible source patterns. It does not silently patch a newer installed app.

Reload the private browser viewer or close/reopen its Home Screen web app. Tap **Dictate**, speak, then **Stop dictation** to put text in the composer. Review it before sending. **Transcribe and send** is a separate existing action and sends the resulting prompt.

Speech-to-text now runs on the remote Mac. Sending the resulting prompt still sends normal task context to the configured AI provider. Existing app recording/history behavior and other provider connections are separate from this transcriber's temporary-file cleanup.
