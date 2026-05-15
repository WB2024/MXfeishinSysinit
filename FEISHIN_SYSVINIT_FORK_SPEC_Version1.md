# Feishin — Sysvinit / MX Linux Compatibility Fork
## AI Development Specification for Claude Sonnet 4.6

---

## Context & Background

This document is a full specification for modifying a fork of the [Feishin](https://github.com/jeffvli/feishin) music player to work correctly on **sysvinit-based Linux distributions**, specifically **MX Linux 25.1 (Infinity)** running kernel `6.12.63+deb13-amd64` without systemd.

You are working inside a cloned fork of `jeffvli/feishin`. The default branch is `development`. All changes should be made on a new branch called `sysvinit-compat`.

---

## System Environment (Target Machine)

| Property | Value |
|---|---|
| **OS** | MX Linux 25.1 Infinity x86_64 |
| **Kernel** | Linux 6.12.63+deb13-amd64 |
| **Init system** | sysvinit (NO systemd, NO systemd-logind) |
| **Display server** | X11 (Xfwm4 / Xfce4 4.20) |
| **Audio stack** | PipeWire 1.4.5 with PulseAudio compatibility layer |
| **Default audio sink** | `alsa_output.usb-FiiO_FiiO_R7_3fa90f5-00.analog-stereo` (FiiO R7 USB DAC) |
| **D-Bus** | System bus running at `/run/dbus/system_bus_socket` |
| **XDG_RUNTIME_DIR** | `/run/user/1000` (set, exists) |
| **Flatpak** | Installed, used to run Feishin currently |
| **MPV** | v0.40.0 at `/usr/bin/mpv` (host system) |
| **Navidrome** | Running as music server backend |
| **Feishin version** | 1.11.0 (Flatpak, `org.jeffvli.feishin`) |

---

## The Core Problem

When Feishin is run as a Flatpak on sysvinit MX Linux, it fails with:

```
Failed to connect to socket /run/dbus/system_bus_socket: No such file or directory
Unhandled rejection: DBusError: org.freedesktop.DBus.Error.ServiceUnknown
```

**Root causes identified:**

1. **Flatpak sandbox (bwrap) blocks access to `/run/dbus/system_bus_socket`** — the system D-Bus socket exists on the host but is not passed through to the sandbox by default.

2. **Electron's Chromium sandbox makes D-Bus calls** that assume `systemd-logind` (`org.freedesktop.login1`) is present — it is not on sysvinit.

3. **Feishin's MPV integration** relies on an IPC socket and assumes it can find and launch the host `mpv` binary — this fails inside the Flatpak sandbox without explicit filesystem access.

4. **The `canberra-gtk3-module`** is missing inside the Flatpak (`Gtk-Message: Failed to load module "canberra-gtk3-module"`).

**What IS working on the host system:**
- D-Bus system bus: ✅ running
- XDG_RUNTIME_DIR: ✅ set to `/run/user/1000`
- PipeWire + PulseAudio compat: ✅ running
- FiiO R7 as default audio sink: ✅ confirmed
- MPV v0.40.0: ✅ installed at `/usr/bin/mpv`
- MPV can see FiiO R7 at: `pipewire/alsa_output.usb-FiiO_FiiO_R7_3fa90f5-00.analog-stereo`

---

## Goals

### Primary Goal
Make Feishin launch and function correctly on sysvinit MX Linux — specifically:
- App launches without D-Bus errors
- MPV playback works (not web audio)
- Audio routes correctly to FiiO R7 via PipeWire
- Navidrome/Subsonic backend connects correctly

### Secondary Goals
- Produce a native `.deb` and/or `.AppImage` build (not Flatpak) as the primary distribution method for sysvinit users
- Patch the Flatpak manifest as a secondary option for users who prefer Flatpak
- Keep all changes minimal and surgical — do not break compatibility with systemd-based distros
- Document all changes clearly for potential upstream PR submission

### Out of Scope
- Rewriting Electron's core D-Bus handling
- Supporting non-Linux platforms
- Adding new Feishin features unrelated to compatibility

---

## Specific Changes Required

### 1. Electron Main Process — D-Bus Hardening

**File to investigate:** `src/main/` (Electron main process files)

**Task:** Find all D-Bus calls or references to `org.freedesktop.login1`, `org.freedesktop.NetworkManager`, or any systemd-specific D-Bus services. Make these calls conditional — if the service is unavailable, fail gracefully rather than throwing an unhandled rejection.

Look for:
- Any use of `dbus-next` (it is in `node_modules/dbus-next`)
- Any `getService()` or `requestName()` calls that don't have try/catch
- Any code that assumes `login1` (logind) is available

**Fix pattern:**
```typescript
// BEFORE (breaks on sysvinit)
const service = await bus.getProxyObject('org.freedesktop.login1', '/org/freedesktop/login1');

// AFTER (sysvinit safe)
try {
  const service = await bus.getProxyObject('org.freedesktop.login1', '/org/freedesktop/login1');
} catch (e) {
  console.warn('[sysvinit-compat] login1 not available, skipping:', e.message);
}
```

---

### 2. Electron Launch Flags — Sandbox & D-Bus

**File to modify:** `src/main/index.ts` (or equivalent Electron entry point)

**Task:** Add Chromium/Electron flags that reduce sandbox D-Bus dependency on sysvinit systems. These should be applied conditionally based on environment detection.

Add the following app flags before `app.whenReady()`:

```typescript
// Detect sysvinit (absence of systemd)
const isSystemd = fs.existsSync('/run/systemd/private');

if (!isSystemd) {
  // sysvinit compatibility flags
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-features', 'MediaSessionService');
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
}
```

**Note:** `no-sandbox` is a security tradeoff — document this clearly in comments and in the README patch. It is acceptable for a trusted local music player on a single-user desktop.

---

### 3. MPV IPC Integration — Path & Socket Hardening

**Files to investigate:** Search for `mpv` references in `src/main/` and `src/preload/`

**Task:** The MPV integration uses an IPC socket to communicate with a running MPV instance. On sysvinit without Flatpak sandbox, the path to MPV and the IPC socket location must be explicit.

**Changes needed:**
- Allow the MPV binary path to be configurable (env var or config file), defaulting to `/usr/bin/mpv`
- Ensure the MPV IPC socket path uses `XDG_RUNTIME_DIR` correctly: `${process.env.XDG_RUNTIME_DIR}/feishin-mpv.sock`
- If `XDG_RUNTIME_DIR` is not set, fall back to `/tmp/feishin-mpv-${process.pid}.sock`
- Add error handling if MPV binary is not found at the configured path

---

### 4. Audio Device Detection — PipeWire/PulseAudio

**Task:** Ensure the audio device selection in Feishin settings correctly enumerates PipeWire devices on sysvinit. The target device is:

```
pipewire/alsa_output.usb-FiiO_FiiO_R7_3fa90f5-00.analog-stereo
```

MPV should be launched with the following audio device flag when this device is selected:
```
--audio-device=pipewire/alsa_output.usb-FiiO_FiiO_R7_3fa90f5-00.analog-stereo
```

Verify MPV is spawned with the correct `--audio-device` argument based on user settings.

---

### 5. Flatpak Manifest Patch

**File to modify:** `org.jeffvli.feishin.metainfo.xml` and any Flatpak manifest/json file in the repo

**Task:** Add the following to the Flatpak finish-args to allow sysvinit users to function with the Flatpak build:

```xml
<finish-args>
  <!-- existing args -->
  <arg>--socket=system-bus</arg>
  <arg>--socket=session-bus</arg>
  <arg>--filesystem=host</arg>
  <arg>--talk-name=org.freedesktop.login1</arg>
  <arg>--talk-name=org.freedesktop.NetworkManager</arg>
</finish-args>
```

Also locate any `flatpak-builder` JSON manifest (may be in `.github/` or `scripts/`) and add equivalent entries.

---

### 6. Native Build Configuration

**File to modify:** `electron-builder.yml`

**Task:** Add a native Linux build target that produces both `.deb` and `.AppImage` outputs suitable for MX Linux / Debian trixie.

```yaml
linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  category: Audio
  maintainer: "WB2024"
  description: "Feishin — sysvinit/MX Linux compatible build"
deb:
  depends:
    - libmpv-dev
    - mpv
    - pipewire
    - libpipewire-0.3-dev
    - dbus
```

---

### 7. README — Add Sysvinit / MX Linux Section

**File to modify:** `README.md`

**Task:** Add a new section after the existing installation instructions:

```markdown
## MX Linux / Sysvinit Compatibility

This fork includes patches for running Feishin on sysvinit-based distributions
(MX Linux, Devuan, Artix sysvinit, etc.) without systemd.

### Known Issues Fixed
- D-Bus system bus access from Flatpak sandbox
- Electron Chromium sandbox D-Bus dependency on systemd-logind
- MPV IPC socket path resolution without systemd-managed runtime dirs

### Native Install (Recommended for sysvinit)
Download the `.deb` or `.AppImage` from Releases and install natively.
The native build avoids Flatpak sandbox restrictions entirely.

### Flatpak Install (sysvinit)
If using Flatpak, apply these overrides after installation:
\`\`\`bash
sudo flatpak override org.jeffvli.feishin --socket=system-bus
sudo flatpak override org.jeffvli.feishin --socket=session-bus
sudo flatpak override org.jeffvli.feishin --filesystem=host
\`\`\`

### MPV Configuration
Set MPV executable path in Feishin Settings → Playback to: `/usr/bin/mpv`
Set audio device to match your PipeWire sink (run `mpv --audio-device=help` to list).
```

---

## Development Instructions for Claude

### Step 1 — Explore Before Changing
Before editing any file, read it fully. Use VS Code's file search to locate all relevant files. Key areas:
- `src/main/` — Electron main process (Node.js, runs with full OS access)
- `src/preload/` — Electron preload scripts (bridge between main and renderer)
- `src/renderer/` — React frontend (runs in Chromium, no direct OS access)
- `scripts/` — Build and utility scripts

### Step 2 — Branch
All work must be on branch `sysvinit-compat`. Do not commit to `development`.

### Step 3 — Change Order
Make changes in this order to allow incremental testing:
1. Electron launch flags (fastest to test — just relaunch)
2. D-Bus error handling in main process
3. MPV IPC path hardening
4. Native build config
5. Flatpak manifest
6. README

### Step 4 — Test Commands
After each change, the user will test with:
```bash
# Native/dev run
pnpm install
pnpm dev

# Production build
pnpm build:linux

# Flatpak test (existing install)
flatpak run org.jeffvli.feishin 2>&1 | grep -v "^$"
```

### Step 5 — Do Not
- Do not add new npm/pnpm dependencies without explicit instruction
- Do not modify anything in `src/renderer/` unless directly related to audio device selection
- Do not change the app's visual design or UX
- Do not remove existing functionality that works on systemd systems
- Do not use `sudo` in any code — this runs as a normal user

---

## Success Criteria

The fork is considered successful when:

- [ ] `pnpm dev` launches Feishin on MX Linux with no fatal D-Bus errors in terminal
- [ ] Feishin connects to Navidrome server successfully
- [ ] Selecting a track and pressing play triggers MPV playback (not web audio)
- [ ] Audio is heard through FiiO R7 → Cambridge Audio amp → Mordaunt Short speakers
- [ ] Unplugging/replugging FiiO R7 does not permanently break audio routing
- [ ] `pnpm build:linux` produces a working `.AppImage` that runs on MX Linux without Flatpak
- [ ] No regressions on standard systemd-based Debian/Ubuntu (changes are conditional)

---

## Reference Information

| Item | Value |
|---|---|
| **Upstream repo** | https://github.com/jeffvli/feishin |
| **Fork owner** | WB2024 |
| **Working branch** | `sysvinit-compat` |
| **Base branch** | `development` |
| **License** | GPL-3.0 |
| **Stack** | Electron + TypeScript + React + Vite |
| **Package manager** | pnpm |
| **Build tool** | electron-builder |
| **MPV path (host)** | `/usr/bin/mpv` |
| **MPV version** | v0.40.0 |
| **Audio device string** | `pipewire/alsa_output.usb-FiiO_FiiO_R7_3fa`](#)
