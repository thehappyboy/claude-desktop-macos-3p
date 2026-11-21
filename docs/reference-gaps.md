# Reference gaps

Compared with `patrickjaja/claude-desktop-extra` and the macOS 3P fork note.

## Already aligned

- Five Computer Use gates patched in `app.asar` (rollout, enabled, opted-out,
  feature status, app-scoped mode).
- `ElectronAsarIntegrity` header hash and the Electron Framework integrity
  dictionary digest are recomputed.
- Non-team entitlements are preserved per component, including
  `com.apple.security.virtualization` on the main app and `Claude Helper.app`;
  the workspace VM starts and reaches `guest_ready`.
- Separate bundle id and display name:
  `com.anthropic.claudefordesktop.3p` / `Claude-3p`.
- `chicagoEnabled=true` and a selectable preferred mode are written to the 3P
  config, with a backup.
- Unit tests for patch anchors and integrity digest; a build verifier for
  signature, hashes, entitlements and app identity.

## Missing, by priority

| Priority | Gap | Reference behavior | Why it matters |
|---|---|---|---|
| P0 | Stable signing identity | Linux has no TCC; the macOS note uses ad-hoc | Resolved: `Claude 3P CU Local Signing` keychain identity is used when present |
| P0 | Helper identity | Not handled in the note | Resolved: helper bundle ids are `.3p.helper*` |
| P0 | Stale `embedded.provisionprofile` | Not handled in the note | Resolved: removed from the output bundle |
| P0 | Minimal nested entitlements | Linux has no equivalent | Resolved: nested components are signed with their own entitlements; main app is signed last without `--deep` |
| P1 | Upstream version tracking | Builds from the official apt repo, with version baselines | Our build copies a local `/Applications/Claude.app`; a future Claude update needs a manual re-audit |
| P1 | End-to-end smoke test | CI builds, launches and checks the app | Unit tests do not prove the real bundle launches, VM boots, or CU logs `enabled=true` |
| P1 | Doctor / diagnostics | `--diagnose`, status page, logs | Resolved: `claude-3p --diagnose` covers signature, hashes, patches, entitlements, 3P config, VM/CU logs and TCC hints; `--json` for machine use |
| P1 | Auto-update / URL-scheme isolation | Upstream update patches and profile routing | The fork may still share the `claude://` handler or updater namespace with the official app |
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
