#!/usr/bin/env python3
import sys
import os
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
    target = m.prepare_frontend_target(app)
    try:
        m.patch_language_whitelist(app, lang)
        if os.environ.get("CLAUDE_ZH_HARDCODED") == "1":
            m.patch_hardcoded_frontend_strings(app, lang)
        else:
            print("[i18n] hardcoded string pass skipped (set CLAUDE_ZH_HARDCODED=1 to enable)")
        m.patch_slash_command_menu(app, m.resource_language_code(lang))
        m.patch_language_display_names(app)
        m.merge_frontend_locale(app, lang)
        m.install_desktop_locale(app, lang)
        m.install_statsig_locale(app, lang)
        m.install_dynamic_locale(app, lang)
        m.finalize_frontend_target(app, target)
    finally:
        m.cleanup_frontend_target(target)
    print("[i18n] Simplified Chinese resources installed (language remains selectable)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
