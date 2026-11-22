# Reference gaps

Compared with `patrickjaja/claude-desktop-extra` and the macOS 3P fork note.

## Already aligned

- Three Computer Use gates patched in `app.asar` (rollout, feature status and
  app-scoped mode). User opt-out, managed `computerUseEnabled` and unreadable
  allowed-apps policies stay in front of the forced rollout.
- `ElectronAsarIntegrity` header hash and the Electron Framework integrity
  dictionary digest are recomputed.
- Non-team entitlements are preserved per component, including
  `com.apple.security.virtualization` on the main app and `Claude Helper.app`;
  the workspace VM starts and reaches `guest_ready`.
- Separate bundle id and display name:
  `com.anthropic.claudefordesktop.3p` / `Claude-3p`.
- `chicagoEnabled=true` and a selectable preferred mode are written to the 3P
  config, with a backup.
- Simplified Chinese is registered in the 3P language whitelist with 37,495
  translated frontend entries, 51 dynamic entries and the official desktop
  `zh-Hans` shell; missing entries fall back to English. The language remains
  user-selectable.
- Unit tests for patch anchors and integrity digest; a build verifier for
  signature, hashes, entitlements and app identity.

## Missing, by priority

| Priority | Gap | Reference behavior | Why it matters |
|---|---|---|---|
| P0 | Stable signing identity | Linux has no TCC; the macOS note uses ad-hoc | Resolved: `Claude-3p Signing` keychain identity is used when present |
| P0 | Helper identity | Not handled in the note | Resolved: helper bundle ids are `.3p.helper*` |
| P0 | Stale `embedded.provisionprofile` | Not handled in the note | Resolved: removed from the output bundle |
| P0 | Minimal nested entitlements | Linux has no equivalent | Resolved: nested components are signed with their own entitlements; main app is signed last without `--deep` |
| P0 | Policy-preserving Computer Use enablement | Linux patch keeps the HIPAA/managed gate and re-checks it per tool call | Resolved at the enablement gate: 3P forces only the GrowthBook rollout; user off, managed `computerUseEnabled=false` and unreadable allowed-apps still return false. 3P HIPAA remains upstream `unrestricted`; a per-call check is still a separate decision |
| P1 | Upstream version tracking | Builds from the official apt repo, with version baselines | Partially resolved: `doctor` compares `/Applications/Claude.app` with the built app; no automatic upstream feed |
| P1 | End-to-end smoke test | CI builds, launches and checks the app | Partially resolved: the installed bundle launches and logs the Computer Use rollout gate; permission re-grant, multi-monitor and real tool-call checks remain a manual acceptance matrix |
| P1 | Doctor / diagnostics | `--diagnose`, status page, logs | Resolved: `claude-3p --diagnose` covers signature, hashes, patches, entitlements, 3P config, source-version delta, auto-update state, VM and Computer Use logs and live TCC state; `--json` for machine use |
| P1 | Auto-update / URL-scheme isolation | Upstream update patches and profile routing | Auto-update is now written to the applied 3P config and checked by `doctor`; URL-scheme ownership is still shared with the official app |
| P2 | Packaging | deb/rpm/pacman/AppImage + CI releases | Ours is a local `.app`; a DMG/PKG and Developer ID notarization are not implemented |
| P2 | Multiple profiles | Per-profile userData and profiles | Fork and official 3P share `Claude-3p` state; concurrent use is not isolated |
| P2 | Feature extras | Themes, custom models, managed settings UI | Not required for Computer Use; only worth porting if wanted |

## What the reference did not solve

- The Linux project's Computer Use bridges are Linux-specific; they do not
  apply to the macOS native executor.
- The macOS 3P note records asar integrity and custom entitlements, but not
  TCC identity, helper bundle ids, `embedded.provisionprofile`, or stable
  signing across rebuilds.
- Its ad-hoc signature has the same TCC-reset risk unless a stable signing
  identity is introduced.
