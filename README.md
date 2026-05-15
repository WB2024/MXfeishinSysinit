<img src="assets/icons/icon.png" alt="logo" title="feishin" align="right" height="60px" width="60px" />

# Feishin — Sysvinit Edition

<p align="center">
  <strong>A fork of <a href="https://github.com/jeffvli/feishin">jeffvli/feishin</a> patched to run on systemd-free Linux distributions.</strong><br>
  Tested on <strong>MX Linux 25.1</strong> with sysvinit, Xfce4, PipeWire, and MPV.
</p>

<p align="center">
  <a href="https://github.com/WB2024/MXfeishinSysinit/blob/sysvinit-compat/LICENSE">
    <img src="https://img.shields.io/github/license/jeffvli/feishin?style=flat-square&color=brightgreen" alt="License">
  </a>
  <a href="https://github.com/WB2024/MXfeishinSysinit/releases/tag/v1.11.0-sysvinit-1">
    <img src="https://img.shields.io/badge/release-v1.11.0--sysvinit--1-blue?style=flat-square" alt="Release">
  </a>
  <a href="https://github.com/WB2024/MXfeishinSysinit/releases">
    <img src="https://img.shields.io/github/downloads/WB2024/MXfeishinSysinit/total?style=flat-square&color=orange" alt="Downloads">
  </a>
  <a href="https://github.com/jeffvli/feishin">
    <img src="https://img.shields.io/badge/upstream-jeffvli%2Ffeishin-grey?style=flat-square&logo=github" alt="Upstream">
  </a>
</p>

---

> **This is a fork.** All credit for the original application goes to
> [jeffvli](https://github.com/jeffvli) and the Feishin contributors.
> This fork exists solely to patch compatibility issues on sysvinit-based systems.
> For systemd-based distros (Ubuntu, Fedora, Arch, etc.) use the
> [official release](https://github.com/jeffvli/feishin/releases) instead.

---

## Why This Fork Exists

Upstream Feishin crashes on sysvinit systems (MX Linux, Devuan, Artix-sysvinit, Void Linux, etc.)
because Chromium's startup sequence expects systemd services (`systemd-logind`, `gnome-keyring`)
that simply don't exist without systemd. This fork applies targeted, minimal patches to fix those
crashes while leaving the behaviour on systemd systems completely unchanged.

**Supported distros (tested or expected to work):**

| Distro | Init | Status |
|--------|------|--------|
| MX Linux 25.1 Infinity | sysvinit | ✅ Tested |
| Devuan Daedalus / Excalibur | sysvinit / OpenRC | ✅ Expected |
| Artix Linux | sysvinit / OpenRC / runit | ✅ Expected |
| Void Linux | runit | ✅ Expected |
| antiX Linux | sysvinit | ✅ Expected |

---

## What's Been Changed

All patches are conditional — they activate only when `/run/systemd/private` is absent
(which is exclusively created by systemd). On a standard systemd system this fork behaves
identically to upstream.

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| **Crash on launch** | Chromium sandbox probes `org.freedesktop.login1` (systemd-logind) | `--no-sandbox` + `--disable-dev-shm-usage` applied on sysvinit only |
| **Passwords not saved between sessions** | Default store is `gnome-libsecret`, requires `gnome-keyring` (not running on Xfce/sysvinit) | Falls back to `basic` password store on sysvinit |
| **MPV socket left in `/tmp`** | Socket was created as `/tmp/node-mpv-<pid>.sock`, not cleaned on crash | Socket now placed in `XDG_RUNTIME_DIR` (auto-cleaned on logout); falls back to `/tmp` |
| **MPRIS crash when session bus missing** | `mpris-service` throws if D-Bus session bus is unavailable | Wrapped in try/catch — MPRIS unavailable is a warning, not a fatal error |
| **`.deb` missing runtime dependencies** | Upstream `.deb` had no `Depends:` field | Added `Depends: libmpv2, pipewire, dbus` to electron-builder config |

> **Security note on `--no-sandbox`:** Disabling the Chromium sandbox is a known tradeoff.
> It is appropriate for a trusted, single-user local music player. It is **never** applied
> on systemd-based systems where this is not needed.

---

## Install

Download from the [Releases page](https://github.com/WB2024/MXfeishinSysinit/releases/tag/v1.11.0-sysvinit-1).

### .deb (recommended for MX Linux / Debian-based)

```bash
sudo dpkg -i Feishin-linux-amd64.deb
sudo apt-get install -f   # resolves any missing deps automatically
feishin                   # launch from terminal, or find it in your app menu
```

### AppImage (portable, no install required)

```bash
chmod +x Feishin-linux-x86_64.AppImage
./Feishin-linux-x86_64.AppImage
```

### tar.xz (manual extract)

```bash
tar -xf Feishin-linux-x64.tar.xz
./Feishin-linux-x64/feishin
```

---

## First-Time Setup

### 1 — MPV

When the app first launches it will ask for your MPV binary path. Enter `/usr/bin/mpv`
(verify with `which mpv`) and restart the app.

**Optional — lock MPV to a specific audio device (e.g. a USB DAC):**

Find your device name:
```bash
mpv --audio-device=help
```
Then open **Settings → Playback → MPV Options** and add:
```
--audio-device=pipewire/alsa_output.usb-YOUR_DEVICE_NAME.analog-stereo
```

Alternatively, set it globally in `~/.config/mpv/mpv.conf`:
```
audio-device=pipewire/alsa_output.usb-YOUR_DEVICE_NAME.analog-stereo
```

### 2 — Add a music server

Click the hamburger menu → **Manage servers** → **Add server**.  
Enter the full URL to your server (e.g. `http://192.168.1.10:4533` for Navidrome).

Supported servers: **Navidrome**, **Jellyfin**, **Airsonic-Advanced**, **Gonic**, **Funkwhale**, **Ampache**, and any [OpenSubsonic](https://opensubsonic.netlify.app/)-compatible API.

### 3 — Passwords (sysvinit note)

On sysvinit systems the `basic` password store is used automatically — no extra setup needed.
Passwords are stored in the Feishin config directory (`~/.config/Feishin/`).

---

## Features

Everything from upstream Feishin, plus the sysvinit fixes above:

- [x] MPV player backend (hardware-accelerated, gapless playback)
- [x] Web player backend
- [x] Modern UI built with React + Mantine
- [x] Scrobble playback to your server
- [x] Smart playlist editor (Navidrome)
- [x] Synchronized and unsynchronized lyrics support
- [x] Discord Rich Presence
- [x] MPRIS 2.0 media key integration (on systems with D-Bus session bus)
- [x] Works on sysvinit — no systemd required

---

## Screenshots

<a href="./media/preview_full_screen_player.png"><img src="./media/preview_full_screen_player.png" width="49.5%"/></a> <a href="./media/preview_album_artist_detail.png"><img src="./media/preview_album_artist_detail.png" width="49.5%"/></a> <a href="./media/preview_album_detail.png"><img src="./media/preview_album_detail.png" width="49.5%"/></a> <a href="./media/preview_smart_playlist.png"><img src="./media/preview_smart_playlist.png" width="49.5%"/></a>

---

## Building from Source

Requires Node.js v24+, pnpm v11+.

```bash
git clone https://github.com/WB2024/MXfeishinSysinit.git
cd MXfeishinSysinit
pnpm install
pnpm approve-builds      # required on first clone (pnpm 11 security policy)

# Development
pnpm run dev

# Production build + package (outputs to dist/)
pnpm run build
./node_modules/.bin/electron-builder --linux
```

Artifacts appear in `dist/`:
- `Feishin-linux-amd64.deb`
- `Feishin-linux-x86_64.AppImage`
- `Feishin-linux-x64.tar.xz`

> **Note:** The first packaging run downloads build tools (~10 MB) to `~/.cache/electron-builder/`.
> Subsequent runs use the cache and are much faster.

### Dev commands

- `pnpm run dev` — Start the development server
- `pnpm run build` — Build main + preload + renderer
- `pnpm run typecheck` — Type-check the project
- `pnpm run lint` — Lint the project

---

## FAQ

### The app crashes immediately on launch

You are likely on a sysvinit system running an unpatched build. Use the releases from
**this fork** rather than the upstream official release.

If you are already using this fork and still see a crash, run from a terminal to see the
error output:
```bash
feishin --enable-logging 2>&1 | head -60
```

### MPV is not working or rapidly toggling pause/play

Check that the MPV path in **Settings → Playback** is correct (`/usr/bin/mpv`).
If the issue persists, reinstall MPV. Known good versions: `v0.35.x`, `v0.36.x`, `v0.40.x`.
`v0.34.x` is a known broken version.

### Passwords are not saved between sessions

On sysvinit this fork automatically uses the `basic` store. If you installed the upstream
version first, there may be a stale `password_store` value in your config. Open
**Settings → Window → Passwords/secret store** and set it to **Basic**.

### I see "The SUID sandbox helper binary was found, but is not configured correctly"

This happens when unprivileged user namespaces are disabled
(`sysctl kernel.unprivileged_userns_clone` returns 0).  
This fork already applies `--no-sandbox` on sysvinit, so this error should not appear.
If it does, ensure you are running the fork's binary and not the upstream one.

### Media keys / MPRIS not working

On sysvinit systems without a D-Bus session bus, MPRIS is silently disabled. This is
expected and non-fatal. If you have `dbus-daemon` running (`ps aux | grep dbus`) but
MPRIS still doesn't work, check that your desktop environment registers a session bus
(most Xfce4 setups on MX Linux do via `/etc/X11/Xsession.d/`).

### What music servers are supported?

- [Navidrome](https://github.com/navidrome/navidrome)
- [Jellyfin](https://github.com/jellyfin/jellyfin)
- [OpenSubsonic](https://opensubsonic.netlify.app/) compatible servers: Airsonic-Advanced, Ampache, Astiga, Funkwhale, Gonic, LMS, Nextcloud Music, Supysonic, Qm-Music

---

## Relationship to Upstream

This fork tracks the `development` branch of [jeffvli/feishin](https://github.com/jeffvli/feishin).
Changes are minimal and surgical — only what is needed for sysvinit compatibility.
No features have been added or removed. The goal is to keep rebasing cleanly onto upstream
as new versions are released.

Pull requests and bug reports for **sysvinit-specific issues** are welcome here.
For general Feishin issues, report them [upstream](https://github.com/jeffvli/feishin/issues).

---

## License

[GNU General Public License v3.0](https://github.com/jeffvli/feishin/blob/dev/LICENSE) — same as upstream.
