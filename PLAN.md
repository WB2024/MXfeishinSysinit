# Feishin — Sysvinit / MX Linux Fork Development Plan

**Branch:** `sysvinit-compat` (to be created from `development`)  
**Base:** Upstream `jeffvli/feishin` v1.11.0 — zero changes committed yet  
**Goal:** Make Feishin launch and play audio on MX Linux 25.1 sysvinit without breaking systemd-based distros

---

## Part 1 — Codebase Reality vs. Spec

Before listing changes, it is essential to document where the spec's assumptions diverge from the actual code. These findings directly alter the change plan.

### Finding 1 — No explicit D-Bus calls exist in Feishin's code

**Spec Item 1 assumed:** Feishin calls `org.freedesktop.login1` or `org.freedesktop.NetworkManager` via `dbus-next` somewhere in `src/main/`.

**Reality:** A full search of the codebase found zero explicit D-Bus calls in Feishin's main process or preload scripts. There is no `dbus-next` usage. Feishin itself does not call `getProxyObject`, `requestName`, or anything similar.

**The D-Bus errors you see come from two external sources:**
1. Chromium's sandbox initialisation (C++ code, not TypeScript) probing `org.freedesktop.login1` to detect a systemd-managed session
2. `mpris-service` registering `org.mpris.MediaPlayer2.Feishin` on the D-Bus **session** bus (not system bus — the session bus is available on your system)

**Consequence:** Spec Item 1's code fix (wrapping `getProxyObject` calls) is dropped entirely — there is nothing to wrap. The fix for problem #1 is the Electron launch flags. Problem #2 is addressed by making MPRIS init non-fatal.

---

### Finding 2 — HardwareMediaKeyHandling and MediaSessionService are already disabled on Linux

**Spec Item 2 assumed:** These features need to be disabled conditionally based on sysvinit detection.

**Reality (src/main/index.ts, lines 783–799):**
```typescript
const shouldDisableMediaFeatures =
    isLinux() || !enableMediaSession || playbackType !== PlayerType.WEB;

if (shouldDisableMediaFeatures) {
    chromiumDisabledFeatures.push('HardwareMediaKeyHandling', 'MediaSessionService');
}
```

Because `isLinux()` is always true on the target system, both features are **already unconditionally disabled on all Linux builds**. The spec's re-addition of these flags would be a no-op.

**Consequence:** The sysvinit-specific work in `chromiumDisabledFeatures` is limited to adding `no-sandbox`. The existing code handles media feature disablement correctly.

---

### Finding 3 — password-store flag defaults to gnome-libsecret

**Spec missed this entirely.**

**Reality (src/main/index.ts, lines 271–273):**
```typescript
if (isLinux() && !process.argv.some((a) => a.startsWith('--password-store='))) {
    const passwordStore = store.get('password_store', 'gnome-libsecret') as string;
    app.commandLine.appendSwitch('password-store', passwordStore);
}
```

The default `password_store` setting is `gnome-libsecret`. On MX Linux with Xfce and no GNOME keyring daemon running, Electron's `safeStorage` (`safeStorage.isEncryptionAvailable()`) will return `false`. The code in `src/main/features/core/settings/index.ts` already guards against this — password get/set handlers return `null`/`false` when encryption is unavailable — but the user experience impact is that **server passwords cannot be saved between sessions**. The user would need to re-enter their Navidrome password every launch.

The fix: on sysvinit, fall back to `basic` password store, which uses the OS keychain absent any keyring (on X11 this is effectively plaintext, but it is functionally equivalent to what the user gets from the Flatpak today). This should be conditional on sysvinit detection, not applied to all Linux.

---

### Finding 4 — MPV socket path is hardcoded to /tmp

**Reality (src/main/features/core/player/index.ts, line 27):**
```typescript
const socketPath = isWindows()
    ? `\\\\.\\pipe\\mpvserver-${pid}`
    : `/tmp/node-mpv-${pid}.sock`;
```

This works but is not XDG-compliant. On a system where `/tmp` is a tmpfs cleared at boot this is fine, but `XDG_RUNTIME_DIR` (`/run/user/1000`) is the correct location for per-session IPC sockets per the XDG Base Directory spec. Using it also avoids stale socket files accumulating in `/tmp` across reboots.

The fix is a one-line change with a fallback: `XDG_RUNTIME_DIR ?? /tmp`.

---

### Finding 5 — MPRIS Player() is instantiated at module top level, no error handling

**Reality (src/main/features/linux/mpris.ts, lines 7–16):**
```typescript
const mprisPlayer = Player({
    identity: 'Feishin',
    ...
});
```

This executes at module import time. If the D-Bus session bus is not available or `mpris-service` fails to connect, this will throw an uncaught exception that crashes the Linux feature module entirely. On your system the session bus is running so this is likely fine, but it is fragile and worth hardening as a defensive measure.

---

### Finding 6 — Flatpak manifest does not exist in this repo

**Spec Item 5 targeted `org.jeffvli.feishin.metainfo.xml` for `<finish-args>` additions.**

**Reality:** `org.jeffvli.feishin.metainfo.xml` is an AppStream metadata file — it describes the app for software centres (release notes, screenshots, categories). It does not accept `<finish-args>` and adding them there would produce invalid XML that is simply ignored by any tooling.

The Flatpak builder manifest (`org.jeffvli.feishin.json` or `.yaml`) lives in the [Flathub repository](https://github.com/flathub/org.jeffvli.feishin), which is a separate repo not part of this fork.

**Consequence:** Spec Item 5 (Flatpak manifest XML modification) is **fully dropped**. The correct recommendation for sysvinit Flatpak users is the `flatpak override` commands documented in the README, exactly as the spec's README section already states.

---

### Finding 7 — electron-builder.yml already has Linux targets

**Reality:** The existing `electron-builder.yml` already declares:
```yaml
linux:
  target:
    - AppImage
    - deb
    - tar.xz
  category: AudioVideo;Audio;Player
```

What is missing is a `deb:` block specifying `depends:` for runtime library requirements. Also: the spec lists `libmpv-dev` as a dependency — this is a development headers package, not a runtime package. The correct runtime dependency for Debian trixie is `libmpv2`.

---

## Part 2 — Definitive Change List

Six files will be modified. One utility function may be added to an existing file. No new dependencies. No new files (except this plan).

Changes are ordered for incremental testing as the spec directs.

---

### Change 1 — `src/main/index.ts` — Sysvinit Detection + Launch Flags

**Priority:** Critical — this is the primary fix for the D-Bus crash on launch.

**What changes:**

Add a `isSysvinit()` detection function early in the file, before `app.whenReady()`. Detection method: check for the absence of `/run/systemd/private` using `fs.existsSync()` — this path is created by systemd itself and reliably absent on sysvinit.

```typescript
// Sysvinit detection — /run/systemd/private is created by systemd; absent on sysvinit
import { existsSync } from 'fs';
const isSysvinit = isLinux() && !existsSync('/run/systemd/private');
```

Then add the `no-sandbox` flag **only** on sysvinit, before `app.whenReady()`:

```typescript
if (isSysvinit) {
    // On sysvinit (no systemd-logind), Chromium's sandbox probes login1 via D-Bus
    // and throws a fatal error. Disabling the sandbox resolves this.
    // Security note: acceptable for a trusted single-user local music player.
    // This flag is NOT applied on systemd-based systems.
    app.commandLine.appendSwitch('no-sandbox');
}
```

Also modify the existing `password-store` block (lines 271–273) to fall back to `basic` on sysvinit instead of `gnome-libsecret`:

```typescript
if (isLinux() && !process.argv.some((a) => a.startsWith('--password-store='))) {
    // On sysvinit systems, gnome-libsecret is unavailable (no gnome-keyring daemon).
    // Fall back to 'basic' which allows credential storage without a keyring daemon.
    const defaultStore = isSysvinit ? 'basic' : 'gnome-libsecret';
    const passwordStore = store.get('password_store', defaultStore) as string;
    app.commandLine.appendSwitch('password-store', passwordStore);
}
```

**Why `basic` and not `kwallet`?**  
MX Linux ships with Xfce, not KDE. `basic` stores credentials without requiring a keyring daemon and is the correct fallback for desktop environments that don't ship either gnome-keyring or KWallet.

**Risk:** Zero risk to systemd systems — the `isSysvinit` guard ensures this is never applied there. The `no-sandbox` flag is a known, documented security tradeoff for trusted local applications.

---

### Change 2 — `src/main/features/core/player/index.ts` — MPV Socket Path

**Priority:** Medium — current `/tmp` path works, but `XDG_RUNTIME_DIR` is the correct location.

**What changes:**

Replace the hardcoded `/tmp` path (line 27) with an XDG-compliant path with `/tmp` fallback:

```typescript
// Use XDG_RUNTIME_DIR for the IPC socket if available (XDG Base Directory spec).
// Falls back to /tmp with PID to avoid stale sockets across reboots.
const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
const socketPath = isWindows()
    ? `\\\\.\\pipe\\mpvserver-${pid}`
    : xdgRuntimeDir
      ? `${xdgRuntimeDir}/feishin-mpv-${pid}.sock`
      : `/tmp/node-mpv-${pid}.sock`;
```

**Why keep the PID suffix?** Without it, a second instance of Feishin would attempt to use the same socket, causing `EADDRINUSE`. The PID makes each run unique.

**Why `feishin-mpv-${pid}` instead of `node-mpv-${pid}`?** The new naming is app-scoped and clearer in `XDG_RUNTIME_DIR` alongside other apps' sockets. The old name is kept in the `/tmp` fallback for consistency with legacy behaviour.

**Risk:** Zero — the change is a conditional expression. If `XDG_RUNTIME_DIR` is unset, behaviour is identical to today.

---

### Change 3 — `src/main/features/linux/mpris.ts` — Non-Fatal MPRIS Init

**Priority:** Low-medium — defensive hardening. MPRIS will likely work fine on your system, but this prevents a crash scenario if session D-Bus is unavailable.

**What changes:**

Wrap the top-level `Player({...})` instantiation in a try/catch so that MPRIS failure is non-fatal. The module should export a nullable player reference and all IPC handlers should guard against `null`.

Currently the code creates `mprisPlayer` at module scope unconditionally. The change:

```typescript
let mprisPlayer: Player | null = null;

try {
    mprisPlayer = Player({
        identity: 'Feishin',
        maximumRate: 1.0,
        minimumRate: 1.0,
        name: 'Feishin',
        rate: 1.0,
        supportedInterfaces: ['player'],
        supportedMimeTypes: ['audio/mpeg', 'application/ogg'],
        supportedUriSchemes: ['file'],
    });
} catch (e) {
    console.warn('[sysvinit-compat] MPRIS D-Bus registration failed — MPRIS unavailable:', e);
}
```

Every subsequent `mprisPlayer.on(...)` and `mprisPlayer.playbackStatus = ...` call must be guarded with `if (!mprisPlayer) return;` or the optional chaining `mprisPlayer?.on(...)`.

The IPC handlers that update MPRIS state (called from the renderer via preload) must also check for `null` before acting.

**Risk:** Low. On systemd systems MPRIS will initialise exactly as before. The only difference is a console warning instead of a crash on session-bus-less environments.

---

### Change 4 — `src/main/utils.ts` — Export `isSysvinit` Helper

**Priority:** Companion to Change 1.

**What changes:**

Rather than inlining the sysvinit detection in `index.ts` and duplicating it if needed elsewhere, add a small exported function to `src/main/utils.ts` alongside the existing `isLinux()`, `isMacOS()`, `isWindows()` helpers:

```typescript
import { existsSync } from 'fs';

/**
 * Returns true if the current system uses sysvinit (no systemd).
 * Detection: /run/systemd/private is created by systemd; its absence indicates sysvinit.
 * Always returns false on non-Linux platforms.
 */
export const isSysvinit = (): boolean => {
    return isLinux() && !existsSync('/run/systemd/private');
};
```

This keeps platform detection logic in one place, consistent with the existing pattern.

**Note:** `index.ts` would then import and call `isSysvinit()` rather than inline the check.

---

### Change 5 — `electron-builder.yml` — Add deb: Dependency Block

**Priority:** Low — the build already produces a `.deb`. This just declares runtime dependencies so the package manager can resolve them on the target system.

**What changes:**

Add a `deb:` top-level block below the existing `linux:` block:

```yaml
deb:
  depends:
    - libmpv2
    - pipewire
    - dbus
  packageCategory: sound
  maintainer: "WB2024"
  description: "Feishin — sysvinit/MX Linux compatible build"
```

**Notes on dependency choices:**
- `libmpv2` — correct runtime package name on Debian trixie (not `libmpv-dev` which is headers-only)
- `libpipewire-0.3-dev` is also a dev package; the runtime lib is pulled in by PipeWire itself
- `mpv` (the CLI binary) is not a hard dependency — it is only needed if the user selects MPV playback mode
- `dbus` ensures the session bus daemon is available (it will be on MX Linux regardless)
- `pipewire` — ensures PipeWire is declared for audio routing

**Risk:** Zero — `deb:` depends are advisory. If a package is already installed (it will be on MX Linux), this is a no-op.

---

### Change 6 — `README.md` — Add MX Linux / Sysvinit Section

**Priority:** Documentation — required for users to know about the fork's purpose and usage.

**What changes:**

Add a new top-level section after the existing Installation section. Content:

- Brief description of what this fork patches and why
- List of specific issues fixed (D-Bus sandbox, password storage, MPV socket path)
- Native install instructions (recommended path: download `.deb` or `.AppImage`)
- Flatpak workaround section with the `flatpak override` commands
- MPV setup guidance (settings → playback, how to find PipeWire device name)
- Note that `no-sandbox` is applied on sysvinit and what that means

---

## Part 3 — What the Spec Said to Do That We Are Dropping

| Spec Item | Reason Dropped |
|---|---|
| **Item 1 — D-Bus main process wrapping** | There are zero explicit D-Bus calls in Feishin's main process TypeScript code. Nothing to wrap. The real fix is `no-sandbox` (Change 1). |
| **Item 2 — Re-add HardwareMediaKeyHandling/MediaSessionService disable** | Already unconditionally disabled on all Linux. Would be a no-op. |
| **Item 4 — Audio device detection changes** | Already implemented correctly. MPV queries `audio-device-list` and populates the settings dropdown. Works natively on PipeWire. No code change needed. |
| **Item 5 — Flatpak manifest XML patch** | `org.jeffvli.feishin.metainfo.xml` is AppStream metadata, not a Flatpak builder manifest. No Flatpak manifest exists in this repo (it lives in the Flathub repo). `flatpak override` commands in the README are the correct user-facing guidance. |

---

## Part 4 — File Change Summary

| File | Change Type | Spec Item | Notes |
|---|---|---|---|
| `src/main/utils.ts` | Addition | New (spec gap) | Add `isSysvinit()` helper function |
| `src/main/index.ts` | Modification | Items 2 + spec gap | Add `no-sandbox` on sysvinit; fix `password-store` default |
| `src/main/features/core/player/index.ts` | Modification | Item 3 | MPV socket path → `XDG_RUNTIME_DIR` with `/tmp` fallback |
| `src/main/features/linux/mpris.ts` | Modification | New (spec gap) | Non-fatal MPRIS init with try/catch |
| `electron-builder.yml` | Modification | Item 6 | Add `deb:` runtime dependency block |
| `README.md` | Addition | Item 7 | Add sysvinit/MX Linux section |

**Total: 6 files. No new npm/pnpm dependencies. No renderer changes. No new files.**

---

## Part 5 — Change Order and Testing Gates

Changes will be made in this exact order, allowing a test after each step.

```
Step 1:  src/main/utils.ts          → isSysvinit() helper
Step 2:  src/main/index.ts          → no-sandbox + password-store fix
         TEST: pnpm dev — should launch with no fatal D-Bus errors
Step 3:  player/index.ts            → XDG_RUNTIME_DIR socket path
         TEST: pnpm dev → select a track → MPV playback (not web audio)
Step 4:  linux/mpris.ts             → non-fatal MPRIS init
         TEST: pnpm dev → check MPRIS visible to playerctl or qdbus
Step 5:  electron-builder.yml       → deb: depends block
         TEST: pnpm build:linux → inspect .deb contents with dpkg -I
Step 6:  README.md                  → documentation
```

---

## Part 6 — Success Criteria Mapping

| Spec Success Criterion | Addressed By |
|---|---|
| `pnpm dev` launches with no fatal D-Bus errors | Change 1 (`no-sandbox` flag) |
| Feishin connects to Navidrome server | No code change needed — network stack unaffected |
| Play triggers MPV playback (not web audio) | Change 2 (socket path) + user setting MPV mode in UI |
| Audio through FiiO R7 | MPV `audio-device-list` already works; user selects device in settings |
| `pnpm build:linux` produces working `.AppImage` | Already works; Change 5 adds deb deps |
| No regressions on systemd systems | `isSysvinit()` guard ensures all changes are conditional |

---

## Part 7 — Known Limitations Not Addressed in This Fork

These are out of scope per the spec but documented for completeness:

1. **`safeStorage` on `basic` password store** — `basic` on X11 without a keyring daemon results in credentials stored in cleartext in Electron's keychain wrapper. This is equivalent to the current Flatpak situation. A follow-on improvement would be to integrate with `secret-tool` (libsecret CLI) directly, but this requires an additional dependency and is out of scope.

2. **`canberra-gtk3-module`** — The spec mentions this as a known Flatpak warning. It is a GTK sound theme module. On the native build it will either be present on the host or the warning will be silently printed and ignored. Not applicable to the `.AppImage`/`.deb` native build path.

3. **Flatpak manifest** — As established, the manifest lives in the Flathub repo. A follow-on PR to `flathub/org.jeffvli.feishin` adding `--socket=system-bus` and `--filesystem=host` finish-args would be the proper fix for Flatpak users. This is out of scope for this fork.

4. **`app.commandLine.appendSwitch` ordering** — On Electron 39, some switches must be set before `app.whenReady()`. All switches in this plan are already in that position in the existing code or will be placed there.

---

*Plan version: 1.0 — ready for review before any code is written.*
