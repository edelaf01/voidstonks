# VoidStonks Desktop

The same app as the website, in its own window, built with Tauri. It loads `../deploy` as it
is, so the app itself has no separate build. For now the Rust side only opens the window.

It comes as an AppImage, `.deb` or `.rpm` on Linux, and as an `.exe` or `.msi` installer on
Windows.

## Getting the installers

The easy way is GitHub Actions. Push a tag like `desktop-v2.7.0`, or run **Build Desktop** by
hand from the Actions tab, and the installers for Linux and Windows show up as artifacts of
that run.

## Building it yourself

Tauri only builds for the system you're on, so Linux gives you the Linux packages and Windows
the Windows ones.

```bash
cd desktop
./check-requirements.sh   # tells you what's missing and how to install it
npm install
npm run tauri dev         # opens the app so you can try it
npm run tauri build       # installers end up in src-tauri/target/release/bundle/
```

On Fedora 44 or newer, export `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1` before `tauri build`,
or the AppImage step fails with `failed to run linuxdeploy`. On an atomic Fedora (Bazzite,
Silverblue, Kinoite) build inside a distrobox with the packages `check-requirements.sh` asks
for plus `xdg-utils`, and pass `--bundles appimage`.

A failed build deletes the previous AppImage, so copy the one you want to keep out of
`target/` first.

## Known issues

- On Wayland, screen sharing for the scanner needs `xdg-desktop-portal` and your desktop's
  backend (`-gnome`, `-kde`…). On X11 it usually just works.
- The content security policy is off (`csp: null`). With it on, Tauri's nonce disables the
  inline `onclick` handlers in `index.html` and nothing responds to clicks. It can come back
  once those handlers move to `addEventListener`.
- The AppImage prints `GStreamer element appsink not found` when it starts. If the scanner
  preview fails, install `gstreamer1-plugins-base` and `gstreamer1-plugins-good` where you
  build and rebuild.
