# Upstream compatibility

This project keeps **one current patch set**, not one patch directory per Claude
Desktop version. `.upstream-version` records the official macOS release against
which the current patch set and runtime acceptance were last validated.

## Check the current state

```bash
claude-3p --check-upstream
```

The command compares:

- `.upstream-version` — the accepted baseline;
- `/Applications/Claude.app` or `--source-app` — the official source app;
- `/Applications/Claude-3p.app` or `--app` — the installed patched build;
- Anthropic's official macOS Squirrel feed — the current production release.

Use `--offline` when the update feed is unavailable. The local checks still run.
Use `--json` for machine-readable output.

Exit code `0` means the source, build and baseline are aligned. Exit code `1`
means a new source version, stale build or missing baseline needs action.

Upstream updates are manual. Download the official Claude Desktop app when you
want to upgrade, then run the local flow below. This repository does not run a
scheduled build or automatically accept a release.

## When a new version appears

1. Replace the local official `Claude.app` with the new release.
2. Run `claude-3p --check-upstream`. A source/baseline mismatch is expected.
3. Build the new 3P app:

   ```bash
   ./scripts/build.sh --app "/path/to/Claude.app" --out "dist/Claude-3p-<version>.app"
   ```

4. Run the complete validation:

   ```bash
   npm test
   ./scripts/verify-build.sh "dist/Claude-3p-<version>.app"
   CLAUDE_3P_APP="$PWD/dist/Claude-3p-<version>.app" \
     node --test tests/real-bundle.test.mjs
   node scripts/doctor.mjs --app "dist/Claude-3p-<version>.app" \
     --source-app "/path/to/Claude.app"
   ```

5. Install and test the changed Computer Use behavior in the real app.
6. Only after acceptance, update the baseline:

   ```bash
   printf '%s\n' "<version>" > .upstream-version
   ```

7. Run `claude-3p --check-upstream` again and commit the code and baseline
   together.

## Patch failure policy

The patch transform remains fail-closed:

- exactly one anchor must match for each of the three gates;
- candidate main chunks are discovered by content, not a fixed filename;
- minified function names are derived from the upstream control flow;
- a missing deployment-mode accessor or ambiguous policy function aborts the
  build.

A successful build means the anchors matched. It does not prove runtime
behavior; the Doctor and real-app Computer Use acceptance still apply.

## What is intentionally not supported

- Reusing an `app.asar` from another Claude version.
- Keeping parallel patch trees for every upstream release.
- Treating the Linux reference project's `.upstream-version` as a macOS target.
- Automatically accepting a new version just because the build passed.
- Publishing `Claude-3p.app`, a DMG or an installer from CI.
