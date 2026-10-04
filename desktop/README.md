# VoidStonks Desktop

The same app as the website in its own window, built with Electron. It adds what a browser
tab can't do: copying to the clipboard while the game has focus, following the game's
`EE.log`, and panels drawn over the Warframe window.

## How it works

- The main process serves the app at `http://voidstonks.localhost:47823` (the next free port up
  to 47830). Same origin as before, so the WFM account features stay off, as on any other
  non-local origin.
- Native features go through `src/preload.cjs` (`window.voidstonksNativo`). The web app talks to
  it from `deploy/js/repositories/launcher.repository.js`. Each feature needs the user's
  permission, stored in `permisos.json` in the app's data folder.
- The overlay is one transparent, click-through window over the game. It draws the panels the
  app sends with HTML and CSS (`overlay/`). On Windows it stays on top with the game in
  borderless mode. On Linux the app runs on XWayland and the window bypasses the window
  manager, so it also shows over a fullscreen game.
- `koffi` finds the game window: `user32` on Windows, `libX11` on Linux.

## Running it

```bash
cd desktop/electron
npm install
npm start                 # serves ../../deploy as it is
```

`VOIDSTONKS_DIR` serves another folder and `VOIDSTONKS_EELOG` forces the log path. F12 opens
the developer tools. If `npm start` prints a Node.js error about `electron` exports, unset
`ELECTRON_RUN_AS_NODE` (some editors set it in their terminals).

## Building

GitHub Actions builds both installers on every push to `main` that touches the app (workflow
**Build Desktop**): an NSIS `.exe` for Windows and an `AppImage` for Linux, as artifacts of the
run. To build locally:

```bash
node scripts-actu/build-dist.mjs          # from the repo root: minified app in dist/
cd desktop/electron && npx electron-builder --linux   # or --win, on Windows
```

Tests for the main process modules live in `tests/electron-escritorio.test.mjs`.
