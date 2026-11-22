# Claude Desktop macOS 3P 分支

在 macOS 上从官方 Claude Desktop 构建独立的 3P 分支，包含简体中文界面、
Computer Use、稳定签名、诊断和更新护栏。

当前验证基线：macOS Claude Desktop `6.28899.6`。

## 结论

- 不重写 Computer Use 执行器。官方 macOS 包已经带原生执行器和 `app-cu-helper`。
- 只强制 3P 的 GrowthBook rollout、状态映射和 app-scoped 三处；用户开关、设备管理策略、allowed-apps 和 denied-apps 可读性检查仍然保留。
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

`configure-3p.mjs` 会把 `disableAutoUpdates=true` 写入已应用的
`configLibrary/<appliedId>.json`。如果首次运行时还没有 `configLibrary`，先启动一次
Claude-3p，再重新运行该命令。

## 中文界面

构建时会安装简体中文资源，但**不强制切换语言**。在左下角账号菜单选择
`Language` → `简体中文` 即可切换；English 仍是默认选项。

- 3P 前端词表：37,050 条中文，9,007 条缺失 key 保留英文。
- 动态词表：51/51。
- 桌面壳词表：官方 `zh-Hans` 为基础。
- 本地覆盖：`patches/zh-CN-overrides.json` 补齐 Computer Use 说明等高频漏译。
- 硬编码替换默认启用：本次构建命中 475/1,824 个 JS 文件、3,823 处；需要关闭时使用
  `CLAUDE_ZH_HARDCODED=0 ./scripts/build.sh`。
- 资源来源：`javaht/claude-desktop-zh-cn`，MIT；见 `THIRD_PARTY_NOTICES.md`。

新 bundle id 首次访问原版 “Claude Safe Storage” 时，macOS 会询问一次钥匙串权限；选择“始终允许”并输入登录密码即可继续使用原有网关密钥，不需要重新输入 API Key。此后使用同一签名身份重建不会重复询问。

首次建议先创建本地签名身份，之后重建不会因 ad-hoc cdhash 变化而反复失效：

```bash
./scripts/setup-signing.sh
./scripts/install-cli.sh
```

构建器会自动使用 `Claude-3p Signing`；没有该身份时回退到 ad-hoc。
从原版或 ad-hoc 版首次切换到这个签名身份时，需要在系统设置里重新授权一次屏幕录制/辅助功能；之后重建复用同一授权。
从旧的 `Claude 3P CU Local Signing` 切换到新身份时同样需要重新授权一次。

## 验证

```bash
node --test tests/*.test.mjs
codesign --verify --deep --strict "dist/Claude-3p.app"
./scripts/verify-build.sh
./scripts/doctor.sh
claude-3p --diagnose
claude-3p --diagnose --json
```

诊断会比较 `/Applications/Claude.app` 与构建出的 `Claude-3p.app` 版本；官方应用更新后
重新构建，避免旧补丁继续运行。
辅助功能和屏幕录制优先读取真实 TCC 状态，只有 TCC 不可读时才回退到应用日志。
Doctor 还会探测当前生效配置里的网关地址和 `/v1/models`，连接被拒绝时会报告 WARN。
如果同时使用 ClaudeMom，切换它的配置档可能重写
`configLibrary/<appliedId>.json` 中的 `inferenceGatewayBaseUrl`。诊断能发现运行时的
3P 模式，但不能证明外部端口仍有服务；连接失败时对照 magpie 的实际监听端口，并运行
`curl http://127.0.0.1:<port>/v1/models` 验证。

启动后在 3P 会话中确认：

0. `~/Library/Logs/Claude-3p/main.log` 出现 `3P mode active`、`[chicago] ... enabled=true ... appScoped=true`（rollout 与背景模式门禁）和配置中的 `chicagoEnabled=true`。前者不代表用户开关状态。
1. 设置里出现 Computer Use / “Claude wants to use your computer” 授权卡。
2. 第一次截图触发 macOS 屏幕录制授权；第一次点击/键入触发辅助功能授权。
3. 用最小任务验证：截图、移动鼠标、单击、键入、滚动。

## 边界

- 不捆绑 Anthropic 的应用本体。构建时从本机已安装的官方应用复制。
- 不做远程分发。本地自签名只适合本机使用；分发给他人需要 Developer ID 签名和公证。
- 上游每次更新都会重新压缩变量名。补丁器会在锚点不匹配时失败，不会静默产出坏包。
- 补丁不绕过 managed `computerUseEnabled=false`、allowed-apps 不可读或 denied-apps 不可读的 fail-closed；用户关闭 `chicagoEnabled` 时 Computer Use 仍然关闭。3P 上游本身把 HIPAA 视为 `unrestricted`；如果组织要求 3P 也强制 HIPAA，需要额外的逐次工具调用检查。
- 本地构建优先使用 `Claude-3p Signing` 自签名身份，保留 Virtualization 等非 team 限定 entitlements，去掉 Anthropic 的 team 标识。

## 目录

- `scripts/patch-app.mjs`：提取、打补丁、重打包、更新完整性哈希、重签名。
- `tests/patch.test.mjs`：门禁语义、用户关闭、设备管理、allowed-apps、幂等性和失败闭合测试。
- `scripts/verify-build.sh`：校验签名、asar 头哈希、二进制摘要和补丁标记。
- `scripts/setup-signing.sh`：创建本地自签名代码签名身份。
- `scripts/configure-3p.mjs`：写入 `chicagoEnabled`、首选模式、`disableAutoUpdates` 并备份 3P 配置。
- `scripts/doctor.sh`：诊断签名、完整性、补丁、entitlements、3P 配置、运行日志、VM 和 TCC 状态。
- `bin/claude-3p`：CLI 入口；`claude-3p --diagnose` 与参考项目的 `--diagnose` 对齐。
- `docs/patch-surface.md`：补丁点、完整性机制和签名边界。
- `docs/testing.md`：测试矩阵、参考项目对比和剩余验收项。
- `dist/build-info.json`：构建版本、源应用和产物哈希。

旧钥匙串 `Claude-3p-CU.keychain-db` 不删除，作为回退；新构建使用
`Claude-3p-Signing.keychain-db` / `Claude-3p Signing`。
