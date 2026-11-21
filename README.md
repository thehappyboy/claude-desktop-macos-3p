# Claude Desktop macOS 3P + Computer Use

在 macOS 上从官方 Claude Desktop 构建一个启用 Computer Use 的 3P 分支。

## 结论

- 不重写 Computer Use 执行器。官方 macOS 包已经带原生执行器和 `app-cu-helper`。
- 只移除 3P 模式下把 Computer Use 特性状态降级的五处运行时门禁，并修正设置状态。
- 输出是独立 `.app`，不覆盖 `/Applications/Claude.app`。
- 修改 `app.asar` 后必须同步 asar 头哈希和 Electron 二进制里的完整性字典摘要。
- 首次从原版或 ad-hoc 版切换签名身份时，macOS 的“屏幕录制”和“辅助功能”授权会失效；使用本地签名身份后，同一 bundle id 的重建可复用授权。

## 使用

```bash
npm install
npm test
./scripts/build.sh --app "/Applications/Claude.app"
./scripts/verify-build.sh
node scripts/configure-3p.mjs
open "dist/Claude-3p.app" --args --3p
```

默认输出 `dist/Claude-3p.app`。先退出正在运行的 Claude，再启动分支，避免单实例转发到原应用。
分支使用独立 bundle id `com.anthropic.claudefordesktop.3p` 和显示名 `Claude-3p`，因此 macOS 的屏幕录制/辅助功能授权不会和原版 Claude 共用。
已安装副本：`/Applications/Claude-3p.app`。

首次建议先创建本地签名身份，之后重建不会因 ad-hoc cdhash 变化而反复失效：

```bash
./scripts/setup-signing.sh
./scripts/install-cli.sh
```

构建器会自动使用 `Claude 3P CU Local Signing`；没有该身份时回退到 ad-hoc。
从原版或 ad-hoc 版首次切换到这个签名身份时，需要在系统设置里重新授权一次屏幕录制/辅助功能；之后重建复用同一授权。

## 验证

```bash
node --test tests/*.test.mjs
codesign --verify --deep --strict "dist/Claude-3p.app"
./scripts/verify-build.sh
./scripts/doctor.sh
claude-3p --diagnose
claude-3p --diagnose --json
```

启动后在 3P 会话中确认：

0. `~/Library/Logs/Claude-3p/main.log` 出现 `3P mode active` 和 `[chicago] ... enabled=true`。
1. 设置里出现 Computer Use / “Claude wants to use your computer” 授权卡。
2. 第一次截图触发 macOS 屏幕录制授权；第一次点击/键入触发辅助功能授权。
3. 用最小任务验证：截图、移动鼠标、单击、键入、滚动。

## 边界

- 不捆绑 Anthropic 的应用本体。构建时从本机已安装的官方应用复制。
- 不做远程分发。本地自签名只适合本机使用；分发给他人需要 Developer ID 签名和公证。
- 上游每次更新都会重新压缩变量名。补丁器会在锚点不匹配时失败，不会静默产出坏包。
- 组织 HIPAA 限制仍然生效；补丁只在 `process.platform === "darwin"` 且 `deploymentMode === "3p"` 时放行。
- 本地构建优先使用 `Claude 3P CU Local Signing` 自签名身份，保留 Virtualization 等非 team 限定 entitlements，去掉 Anthropic 的 team 标识。

## 目录

- `scripts/patch-app.mjs`：提取、打补丁、重打包、更新完整性哈希、重签名。
- `tests/patch.test.mjs`：补丁锚点、幂等性和失败闭合测试。
- `scripts/verify-build.sh`：校验签名、asar 头哈希、二进制摘要和补丁标记。
- `scripts/setup-signing.sh`：创建本地自签名代码签名身份。
- `scripts/configure-3p.mjs`：写入 `chicagoEnabled`、首选模式并备份 3P 配置。
- `scripts/doctor.sh`：诊断签名、完整性、补丁、entitlements、3P 配置、运行日志、VM 和 TCC 状态。
- `bin/claude-3p`：CLI 入口；`claude-3p --diagnose` 与参考项目的 `--diagnose` 对齐。
- `docs/patch-surface.md`：补丁点、完整性机制和签名边界。
- `dist/build-info.json`：构建版本、源应用和产物哈希。
