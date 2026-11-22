# Testing and reference comparison

Tested on 2026-11-22 against macOS Claude Desktop `6.28899.6`.
Reference tree: `patrickjaja/claude-desktop-extra` commit `914bb67`
(Linux upstream baseline `6.28899.6`; Homebrew macOS cask is also `6.28899.6`).

## Test layers

| Layer | Command | Current result |
|---|---|---|
| Gate semantics, installed-bundle, config writer and upstream checker | `npm test` | 24/24 pass |
| Bundle signature, entitlements and integrity | `./scripts/verify-build.sh <app>` | pass |
| Computer Use patch policy and stale-marker checks | `./scripts/verify-build.sh <app>` | pass |
| Installed app launch | `open -n /Applications/Claude-3p.app --args --3p` | starts in 3P mode |
| Runtime diagnostic | `claude-3p --diagnose` | 36 pass, 0 warn, 0 fail |
| Upstream baseline and official feed | `claude-3p --check-upstream` | source/build/baseline/latest all `6.28899.6` |
| TCC | `doctor` reads system and user `TCC.db` | Accessibility and Screen Recording granted; unreadable/missing rows are reported as `unknown`, not denied |

The unit suite covers:

- 3P rollout enabled while `chicagoEnabled` remains required.
- User opt-out: `SP()` false, `gGr()` true.
- Managed `computerUseEnabled=false`: rollout and enabled gates false.
- Unreadable allowed-apps and denied-apps settings: fail closed, and the
  status mapper does not report `supported`.
- The installed app.asar's real `xP()` and `uxi()` reject `FWr()=false`
  (denied-apps unreadable) and do not report `supported`.
- HIPAA remains a deny when the enabled gate reports it.
- App-scoped mode is enabled only on macOS 15+ in 3P.
- 1P remains untouched by the 3P patch.
- The deployment accessor is discovered from `mP()` and the patch fails closed
  when it cannot be identified.
- Patch idempotency, stale old-patch rejection and anchor failure.
- Upstream semver comparison, official Squirrel feed URL/payload parsing, and
  online/offline baseline assessment.
- `configure-3p` writes `disableAutoUpdates=true` to the applied config and
  backs up both configuration files.
- `configure-3p` validates both config files before writing, and rolls the main
  file back when the applied config cannot be written.

`verify-build.sh` additionally checks the actual minified main chunk for:

- the three patch markers (`rollout`, `status`, `appscoped`);
- absence of the old `enabled` and `optedout` markers;
- presence of the `chicagoEnabled` rollout and opt-out expressions;
- asar header hash, Electron integrity dictionary, helper identities,
  minimal entitlements, virtualization and Chinese resources.

## Manual acceptance matrix

These need a real user session and should be run after a signing or upstream
change:

| Case | Expected |
|---|---|
| Computer Use enabled, app-scoped mode | screenshot and click in an approved app |
| Computer Use disabled by user | no Computer Use tool calls; setting remains off |
| Managed `computerUseEnabled=false` | Computer Use off; no tool calls |
| Allowed-apps list unreadable | Computer Use off (fail closed) |
| Full control mode | screen/mouse/keyboard controlled |
| Background mode | Computer Use works without taking over the full screen |
| Multiple displays | screenshot and pointer coordinate mapping |
| Accessibility/Screen Recording revoked | clear permission failure, then re-grant |

The user-off case was manually confirmed on the installed build on
2026-11-22. The remaining manual cases are still open.

## Comparison with the reference

| Area | Reference | This project |
|---|---|---|
| Platform | Linux repackage | macOS `.app` fork |
| Computer Use executor | Bundled Linux bridges | Official macOS native executor |
| Computer Use gates | 70 sub-patches, four bridges | 3 minified gate changes |
| Policy | HIPAA/managed gates preserved | User, managed and allowed-apps checks preserved; 3P HIPAA remains upstream `unrestricted` |
| Diagnostics | `--diagnose`, status page | `--diagnose` with signature, hashes, source-version, auto-update, gateway reachability and live TCC |
| Updates | Own GitHub release feed | Auto-updates disabled in the applied 3P config |
| Tests | 103 feature harnesses, Linux smoke test | 24 semantic/installed-bundle/config/upstream tests, bundle verifier, installed launch |
| Profiles | Named Linux profiles and URL routing | Separate 1P/3P identity; no multiple 3P profile isolation |
| Non-Anthropic models | Main + ion-dist opt-in patch | Out of project scope: magpie owns gateway model mapping; current Claude picker exposes 23 configured models and the gateway endpoint returns 24 |
| Themes/IDE extras | 27 community patches | Not ported; unrelated to Computer Use |

Observed magpie `/v1/models`: 24 non-Anthropic IDs with display name, context
window, modalities, reasoning levels and tool-call metadata; no
`anthropic_family_tier`. Claude 6.28899.6 logs `picker = 23`, so this build does
not apply the name filter to that discovery result. The project should not
duplicate magpie's mapping.

The reference's Linux bridges, background-display executor, AT-SPI tools,
glow/drawn-cursor implementation and Escape watcher are intentionally not
ported: the macOS native executor already provides the corresponding path.

## Remaining gaps

- The installed build is `6.28899.6`; later official releases require a clean
  build, anchor re-audit and a new Computer Use acceptance run.
- Upstream release detection is currently an explicit command, not a scheduled
  service. A future automation can call `claude-3p --check-upstream --json`.
- No automated macOS smoke script yet; the launch check is currently a
  documented manual command.
- URL-scheme ownership is shared with the official app; a router is only
  needed when using official 1P sign-in or Office365 callbacks side by side.
- Gateway/model mapping is magpie's responsibility. Re-test after a macOS
  upstream upgrade; do not add a Claude-3p model-mapping layer unless the
  Claude app itself starts filtering a list that magpie already serves.
- Multiple isolated 3P profiles would need distinct bundle/signing identities
  and URL routing, not just separate userData.
