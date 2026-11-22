# Patch surface

Target: macOS Claude Desktop `6.6395.1`, output bundle
`com.anthropic.claudefordesktop.3p` / display name `Claude-3p`.
`CFBundleName` stays `Claude` because Electron locates its helper apps by that
name; changing it requires renaming every `Claude Helper*.app`.

The macOS native Computer Use executor is already shipped. The patch does not
replace it. It changes three minified functions in
`.vite/build/index.chunk-CEv0BLqc.js`:

| Gate | Upstream behavior | Patched behavior in 3P |
|---|---|---|
| rollout | GrowthBook/account rollout can leave `computerUseRollout` unavailable | force the rollout answer on darwin + 3p after the managed `computerUseEnabled` and allowed-apps checks |
| status mapper | Maps the gates to the SPA feature status | return `supported` on darwin + 3p after the managed-settings failure branch |
| app-scoped mode | Requires GrowthBook `appScopedEnabled` | enabled on macOS 15+ in 3P |

`isComputerUseEnabled` (`GP`) and `isComputerUseAvailableButOptedOut` (`iBr`) are
not replaced. They continue to require `chicagoEnabled`; the settings UI sees
the opt-out state instead of a forced-on state. The managed
`computerUseEnabled=false` and unreadable allowed-apps policies remain in front
of the forced rollout.

Upstream's 3P deployment treats the Cowork HIPAA gate as `unrestricted`. This
patch neither changes nor strengthens that upstream decision; an organization
that needs HIPAA enforcement in 3P requires a separate per-tool-call check.

Observed startup line after the patch:

```text
[custom-3p] 3P mode active { provider: 'gateway' }
[chicago] GrowthBook chicago_config: raw=undefined → enabled=true ...
```

Here `enabled` is the rollout gate (`WP()`), not the user's `chicagoEnabled`
preference. The separate preference check remains authoritative.
Before the patch the same line had `enabled=false`.

## Integrity

Two independent values must match:

1. `ElectronAsarIntegrity["Resources/app.asar"].hash` is the SHA256 of the
   canonical asar header JSON, not the whole `.asar` file.
2. Newer Electron builds embed a digest of the whole integrity dictionary in
   `__DATA_CONST,__asar_integrity` in the Electron Framework binary. The patch
   recomputes and writes that digest into every architecture slice.

If either value is stale, Electron exits with:

```text
Failed to get integrity for validatable asar archive: Resources/app.asar
```

## Signing

Anthropic's entitlements contain their Developer ID team. Keeping them on an
ad-hoc signature makes launchd reject the app with POSIX error 153. The build
therefore strips the team-bound keys and preserves each component's other
entitlements.

`Claude Helper.app` and the main app keep Virtualization; the renderer keeps
only `allow-jit`; `app-cu-helper` keeps none. Without Virtualization the
workspace VM reports `entitlement_missing` and shows "Claude's installation
appears to be invalid or has been modified."

`scripts/setup-signing.sh` creates a local self-signed identity
`Claude-3p Signing` in `Claude-3p-Signing.keychain-db`. The build uses it
when present and falls back to ad-hoc otherwise. A stable identity avoids a
new TCC grant after every rebuild.

Consequences:

- Screen Recording and Accessibility permissions are granted once per signing
  identity; changing identity requires granting them again.
- Keychain-backed 1P credentials may be unavailable.

## Chinese UI

The build vendors the MIT-licensed `javaht/claude-desktop-zh-cn` resources and
patches `ion-dist.asar` without forcing a locale:

- adds `zh-Hans` to the frontend language whitelist;
- merges 37,495 translated frontend entries (7,784 fall back to English);
- installs the 51-entry dynamic catalog and official desktop `zh-Hans` shell;
- leaves the built-in Language menu in control.

The hardcoded-string replacements are on by default. The build uses
`rg -F -f` to preselect matching JS files and only applies the guarded
replacement rules there; set `CLAUDE_ZH_HARDCODED=0` to skip this pass.
