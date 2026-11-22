# AGENTS.md

Scope: the entire repository.

## Product

This repository builds a local macOS 3P branch from the official Claude Desktop
app. The product is the official binary plus three narrow Computer Use rollout
patches, selectable Simplified Chinese resources, stable local signing,
diagnostics and update protection. Keep upstream behavior otherwise.

Use the full term **Computer Use** in code comments, docs and reports.

## Read by task

- Changing a patch, integrity handling or signing: read
  `docs/patch-surface.md` and the relevant tests first.
- Handling a new official Claude version or changing `.upstream-version`: follow
  `docs/upstream.md`.
- Changing validation or deciding what still needs runtime acceptance: read
  `docs/testing.md`.
- Considering a feature from the Linux reference project: read
  `docs/reference-gaps.md`; port the engineering guardrail or user-visible
  behavior, not the Linux executor.

## Hard invariants

- **Pristine source.** Build from an unmodified official `Claude.app` whose
  bundle id is `com.anthropic.claudefordesktop`. Extract and patch `app.asar`
  through the scripts; generated and installed apps are never patch inputs.
- **Policy stays upstream.** Preserve the user's `chicagoEnabled` switch,
  managed `computerUseEnabled`, allowed-apps readability, denied-apps
  readability and HIPAA decisions. Force only the 3P GrowthBook rollout,
  feature-status answer and app-scoped mode.
- **Fail closed.** Every patch anchor must match exactly once. Unknown upstream
  shapes abort the build; never weaken an anchor just to make a build pass.
- **One current patch set.** `.upstream-version` names the accepted upstream
  baseline. Do not add per-version patch directories or copy an `app.asar`
  between Claude releases.
- **Source-only publication.** GitHub publishes scripts, tests and docs. Keep
  app bundles, DMGs, build artifacts and release-signing material local.
- **Integrity is generated.** Let `scripts/patch-app.mjs` update the asar header
  hash and Electron integrity dictionary. Do not hand-edit either value.
- **Identity is stable.** Keep bundle id
  `com.anthropic.claudefordesktop.3p`, display name `Claude-3p`, and the
  `Claude` bundle/product names required by Electron helper lookup.
- **Signing is stable.** Prefer the `Claude-3p Signing` identity. Use
  `scripts/setup-signing.sh` when it is missing; changing the identity resets
  macOS Screen Recording and Accessibility grants.
- **Chinese is selectable.** Build Simplified Chinese resources and partial
  English fallback. Leave the language menu in control; session-visible text
  stays concise and natural.

## Working loop

1. Read the task-routed doc and inspect the existing code, tests and generated
   evidence before editing.
2. Make the smallest coherent source change. Add or update a test when behavior,
   parsing, policy or failure handling changes.
3. Run the narrowest test first, then the change-type gate below.
4. Report separate evidence for source tests, build verification and real-app
   runtime checks. A green build proves patch application, not runtime behavior.

## Completion gates

| Change | Required evidence before reporting complete |
|---|---|
| Docs or comments only | `git diff --check`; verify every referenced path exists |
| Patch, verifier or diagnostics logic | `npm test`, a clean build, `scripts/verify-build.sh <app>`, real-bundle test |
| Computer Use gates or policy behavior | The previous gate plus install, `doctor`, real Computer Use screenshot/click acceptance |
| New upstream version | Every row above plus `claude-3p --check-upstream` alignment; update `.upstream-version` only after manual acceptance |

Core commands:

```bash
npm test
./scripts/build.sh --app "/Applications/Claude.app" --out "dist/Claude-3p-<version>.app"
./scripts/verify-build.sh "dist/Claude-3p-<version>.app"
CLAUDE_3P_APP="$PWD/dist/Claude-3p-<version>.app" node --test tests/real-bundle.test.mjs
node scripts/doctor.mjs --app "dist/Claude-3p-<version>.app" --source-app "/Applications/Claude.app"
claude-3p --check-upstream
```

## Implementation conventions

- Keep `scripts/patch-app.mjs` as the single source of minified-bundle
  transforms. Keep its pure transform testable in `tests/patch.test.mjs`.
- Diagnose installed bundles in `tests/real-bundle.test.mjs`; verify signatures,
  hashes, entitlements and markers in `scripts/verify-build.mjs`.
- Keep configuration writes transactional: validate all inputs, back up user
  files, then write. Preserve unrelated profile keys.
- Treat gateway/model mapping as magpie's responsibility. This repository
  installs 3P inference settings and diagnostics; it does not translate model
  catalogs.
- External profile managers such as ClaudeMom may rewrite the applied gateway
  URL. Diagnose drift and report it; edit user configuration only when the task
  asks for a repair.

## Configuration and secrets

Read `~/Library/Application Support/Claude-3p/claude_desktop_config.json` and
`configLibrary/<appliedId>.json` for diagnostics. Print only non-secret fields
such as provider, gateway URL, booleans and model counts. Keep API keys,
keychain contents, cookies, tokens and signing passwords out of chat, logs,
tests and commits.

## Documentation and git

- Update `README.md`, `docs/upstream.md` or `docs/testing.md` when behavior,
  commands, baselines or test counts change. Keep one source of truth.
- Update `.upstream-version` in the same commit as the accepted compatibility
  change, never before runtime acceptance.
- Commit source, tests and documentation only when the user asks. Before a
  commit, run `git diff --check` and inspect `git status`.
- Keep generated apps, `dist/`, logs, user configuration and local backups such
  as `Claude-backup.app/` out of commits.
