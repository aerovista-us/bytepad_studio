# BytePad Studio v5 — Open canvas in OS territory

v5 = v4 + PWA install + save/open as file + document title + OS-style shortcuts.

## Quick start

- **Web:** Open `index.html` in a browser (works for basic use).
- **PWA / offline install:** Use a local HTTP server or GitHub Pages. Opening the file via `file://` will not register the service worker or manifest (browser security). For local testing: `python -m http.server 8080` then open `http://localhost:8080`, or use any static server.
- **Install:** When served over HTTP(S), use the browser’s “Install” / “Add to home screen” when available (PWA).

## What’s in v5

- **PWA** — `manifest.json` and `sw.js` for installability and offline shell. The SW uses cache-first for the shell and network-first for `app.js` and `styles.css` so updates load without stale cache. To force cache invalidation on deploy, bump the `CACHE` version in `sw.js` (e.g. `bytepad-v5-3`).
- **Save as file** — File → Save as file… (Ctrl+Shift+S) → downloads current board as `.bytepad`.
- **Export as ZIP with media** — File → Export as ZIP with media… → one `.zip` containing `export.json` plus all images/audio/video from the board (IndexedDB blobs). Open that `.zip` via Open from file to restore board and media on this or another device.
- **Open from file** — File → Open from file… (Ctrl+O) → open `.bytepad`, `.json`, or `.zip` (ZIP with media).
- **Document title** — Window/tab title: “BytePad Studio v5 — [Board name]”.
- **Shortcuts** — Ctrl+O Open, Ctrl+Shift+S Save as file (plus v4 shortcuts).

Same as v4: multi-board, connections, cut/copy/paste, structured templates (Task, Meeting, Media), connection culling, command palette, themes, settings.

## Storage

- **localStorage:** `notes_v5_meta`, `notes_v5_board_<id>`, `notes_v5_connections_<id>`, etc. (separate from v4).
- **IndexedDB:** `bytepad_assets_v5`.

## Docs

- Plan: `docs/bytepad-v5-plan.md`
- Final evolution: `docs/bytepad-final-evolution.md`
