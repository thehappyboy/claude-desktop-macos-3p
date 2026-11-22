# Claude Desktop Simplified Chinese resources

Vendored from [javaht/claude-desktop-zh-cn](https://github.com/javaht/claude-desktop-zh-cn)
release 1.4.26, commit `59f570a`.

Only the Simplified Chinese (`zh-CN` resource / `zh-Hans` runtime locale)
resources are used. The upstream project is MIT licensed; see `LICENSE`.

Coverage against Claude Desktop 6.6395.1's 3P frontend:

- 37,495 translated keys
- 7,784 English fallbacks
- 51/51 dynamic entries
- 1,201 desktop-shell entries (official `zh-Hans` is used as the base)

The 4,068 hardcoded-string replacements are applied by default. The build
uses `rg` to preselect matching files; set `CLAUDE_ZH_HARDCODED=0` to skip
the pass.
