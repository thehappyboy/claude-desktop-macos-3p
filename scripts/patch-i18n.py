#!/usr/bin/env python3
import sys
import os
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "vendor" / "zh-CN" / "scripts" / "patch_claude_zh_cn.py"


def load_module():
    sys.path.insert(0, str(MODULE.parent))
    import patch_claude_zh_cn
    return patch_claude_zh_cn


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: patch-i18n.py <Claude.app> [zh-Hans]")
    app = Path(sys.argv[1]).resolve()
    lang = sys.argv[2] if len(sys.argv) > 2 else "zh-Hans"
    if lang != "zh-Hans":
        raise SystemExit(f"Only zh-Hans is supported, got {lang}")
    if not app.is_dir():
        raise SystemExit(f"App not found: {app}")

    m = load_module()
    def apply_overrides():
        override_path = ROOT / "patches" / "zh-CN-overrides.json"
        target = app / "Contents" / "Resources" / "ion-dist" / "i18n" / "zh-Hans.json"
        if not override_path.is_file() or not target.is_file():
            return
        overrides = json.loads(override_path.read_text(encoding="utf-8"))
        catalog = json.loads(target.read_text(encoding="utf-8"))
        catalog.update(overrides)
        m.save_json(target, catalog)
        print(f"[i18n] applied {len(overrides)} local translation override(s)")

    def patch_hardcoded_fast():
        assets = m.find_frontend_assets_dir(app)
        if assets is None:
            raise SystemExit("Cannot find frontend assets for hardcoded replacements")
        items = m.load_frontend_hardcoded_replacements(
            m.resource_language_code(lang)
        )
        rules = m._prepare_hardcoded_rules(items)
        m._WORKER_RULES = rules
        source_strings = [source for source, _target in items if "\n" not in source]
        if not source_strings:
            return
        target_by_source = dict(items)
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", delete=False, prefix="claude-zh-hardcoded-"
        ) as fh:
            fh.write("\n".join(source_strings) + "\n")
            pattern_file = fh.name
        try:
            rg = shutil.which("rg")
            if rg:
                result = subprocess.run(
                    [rg, "--no-ignore", "--json", "-o", "-F", "-f", pattern_file, str(assets)],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                )
                matches = {}
                for line in result.stdout.splitlines():
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") != "match":
                        continue
                    path_text = event.get("data", {}).get("path", {}).get("text")
                    if not path_text or not path_text.endswith(".js"):
                        continue
                    found = matches.setdefault(Path(path_text), set())
                    for submatch in event.get("data", {}).get("submatches", []):
                        text = submatch.get("match", {}).get("text")
                        if text in target_by_source:
                            found.add(text)
            else:
                matches = {
                    path: set(source_strings)
                    for path in sorted(assets.glob("*.js"))
                }
            patched_files = 0
            replaced = 0
            for path, sources in matches.items():
                text = path.read_text(encoding="utf-8")
                original = text
                for source in sorted(sources, key=len, reverse=True):
                    text, count = m.replace_frontend_hardcoded_text(
                        text, source, target_by_source[source]
                    )
                    replaced += count
                if text != original:
                    path.write_text(text, encoding="utf-8")
                    patched_files += 1
            print(
                f"[i18n] hardcoded replacements: {replaced} in "
                f"{patched_files}/{len(matches)} matched files"
            )
        finally:
            Path(pattern_file).unlink(missing_ok=True)

    target = m.prepare_frontend_target(app)
    try:
        m.patch_language_whitelist(app, lang)
        if os.environ.get("CLAUDE_ZH_HARDCODED", "1") != "0":
            patch_hardcoded_fast()
        else:
            print("[i18n] hardcoded string pass disabled by CLAUDE_ZH_HARDCODED=0")
        m.patch_slash_command_menu(app, m.resource_language_code(lang))
        m.patch_language_display_names(app)
        m.merge_frontend_locale(app, lang)
        m.install_desktop_locale(app, lang)
        m.install_statsig_locale(app, lang)
        m.install_dynamic_locale(app, lang)
        apply_overrides()
        m.finalize_frontend_target(app, target)
    finally:
        m.cleanup_frontend_target(target)
    print("[i18n] Simplified Chinese resources installed (language remains selectable)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
