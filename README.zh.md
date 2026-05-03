# Claude HUD

一个 Claude Code 插件，实时显示正在发生的事情——上下文使用率、活跃工具、运行中的 Agent 和待办进度。始终在你的输入下方可见。

[![License](https://img.shields.io/github/license/Heartcoolman/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Heartcoolman/claude-hud)](https://github.com/Heartcoolman/claude-hud/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

> 🌐 [English README](README.md) | 中文文档
>
> 🔀 本仓库 fork 自 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)，
> 新增了 **ReClaude 拼车配额接入**（见下方 [ReClaude 章节](#reclaude-拼车配额接入fork-专属仅-macos)）。

## 安装

在 Claude Code 实例中，运行以下命令：

**步骤 1：添加市场**
```
/plugin marketplace add Heartcoolman/claude-hud
```

**步骤 2：安装插件**

<details>
<summary><strong>⚠️ Linux 用户：请先点击此处</strong></summary>

在 Linux 上，`/tmp` 通常是独立的文件系统（tmpfs），这会导致插件安装失败并报错：
```
EXDEV: cross-device link not permitted
```

**修复方法**：在安装前设置 TMPDIR：
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

然后在该会话中运行下面的安装命令。这是 [Claude Code 平台的限制](https://github.com/anthropics/claude-code/issues/14799)。

</details>

```
/plugin install claude-hud
```

安装完成后，重新加载插件：

```
/reload-plugins
```

**步骤 3：配置状态栏**
```
/claude-hud:setup
```

<details>
<summary><strong>⚠️ Windows 用户：如果 setup 提示未找到 JavaScript 运行时，请点击此处</strong></summary>

在 Windows 上，Claude HUD setup 支持的运行时是 Node.js LTS。如果 setup 提示未找到 JavaScript 运行时，请先为你的 shell 安装 Node.js：
```powershell
winget install OpenJS.NodeJS.LTS
```
然后重启 shell 并再次运行 `/claude-hud:setup`。

</details>

完成！重启 Claude Code 以加载新的 statusLine 配置，HUD 将会出现。

在 Windows 上，setup 写入新的 `statusLine` 配置后，请完整重启 Claude Code。

---

## ReClaude 拼车配额接入（fork 专属、仅 macOS）

本 fork 在 `Context | Usage` 之下额外渲染一行 **`ReClaude`**，显示
[reclaude.ai](https://reclaude.ai) 拼车 5 小时配额——**金额进度条** + **时间进度条**——
直接从 reclaude 的计费接口拉取。

### 安装

```
/claude-hud:reclaude-setup
```

向导会引导你：

1. 输入你的 reclaude.ai 邮箱
2. 在终端里跑一行小脚本，把密码存入 **macOS Keychain**
   （**密码全程不经过 Claude Code 本身**）
3. 自动把 `display.reclaude` 块合并进 `~/.claude/plugins/claude-hud/config.json`，
   保留你已有的所有其他配置项不变
4. 立即触发首次 fetch，并显示成功 / 失败的可见反馈

完成后状态栏形如：

```
[Opus] │ my-project git:(main*)
Context ███░░░░░░░ 29% │ Usage ███░░░░░░░ 26% (38m / 5h)
ReClaude $ █████░░░░░ 47% ($23.69/$50) | ⏱ ██░░░░░░░░ 21% (3h 57m / 5h)
```

### 自动刷新原理

每 60 秒 fetcher 优先用缓存里的 cookie 拉一次。一旦 reclaude 返回 401：

1. 自动 POST `{email, password}`（密码通过 `security` CLI 从 Keychain 取出）到 `/api/auth/login`
2. 抓取返回的 `Set-Cookie: rc_sid=...` 写回你的 config（**原子写入**、保留其它字段）
3. 用新 cookie 重发请求、缓存数据
4. 下一次状态栏 tick 即显示新数据

整套流程**无需任何浏览器交互**。同时为防止持续错误密码下打爆登录接口，连续 401
触发 **5 分钟冷却**。

### 手动 cookie 路径（Linux / Windows）

自动刷新依赖 macOS Keychain，所以仅 macOS 可用。其它平台仍可手动贴 cookie 渲染：

1. 浏览器访问 `https://reclaude.ai/app`，确认已登录
2. DevTools → **Application** → **Cookies** → `reclaude.ai` → 复制 `rc_sid` 值
3. 编辑 `~/.claude/plugins/claude-hud/config.json`：
   ```json
   {
     "display": {
       "reclaude": {
         "enabled": true,
         "cookie": "rc_sid=粘贴你的值"
       }
     }
   }
   ```
4. 过期后再来一次（一般几天有效，但你在别处登录会让旧 session 立即失效）

### 关闭

```bash
# 1. 编辑 config.json 删掉 "reclaude" 块：
$EDITOR ~/.claude/plugins/claude-hud/config.json

# 2. 从 Keychain 移除密码（macOS）：
security delete-generic-password -a 你的邮箱 -s claude-hud-reclaude

# 3. 清理缓存与 sentinel：
rm -rf ~/.cache/claude-hud
```

### 安全说明

- `email` 以明文存于 `config.json`（默认 `chmod 600`）
- `password` **永远不被 claude-hud 写入磁盘**；仅 Keychain 持有，fetcher 在每次需要时
  通过 `security find-generic-password` 临时读取
- `rc_sid` cookie 短时间内有效、自动轮转；视为密码处理（`config.json` 已 `chmod 600`）
- fetcher 仅访问两个接口：`GET /api/app/billing/carpool-quota` 与
  `POST /api/auth/login`，**不会传输任何对话数据**

---

## 什么是 Claude HUD？

Claude HUD 让你在 Claude Code 会话中获得更清晰的洞察。

| 你看到的内容 | 为什么重要 |
|--------------|------------|
| **项目路径** | 知道你当前在哪个项目中（可配置 1-3 级目录深度） |
| **上下文健康度** | 在上下文窗口满之前准确了解还剩多少 |
| **工具活动** | 实时观察 Claude 读取、编辑和搜索文件 |
| **Agent 追踪** | 查看哪些子 Agent 正在运行以及它们在做什么 |
| **待办进度** | 实时跟踪任务完成情况 |

## 显示效果

### 默认（2 行）
```
[Opus] │ my-project git:(main*)
上下文 █████░░░░░ 45% │ 用量 ██░░░░░░░░ 25% (1h 30m / 5h)
```
- **第 1 行** — 模型、提供商标签（如能正面识别，例如 `Bedrock`、`Vertex`）、项目路径、git 分支
- **第 2 行** — 上下文进度条（绿 → 黄 → 红）和使用率限制
  - 紧凑括号格式 `(38m / 5h)`，5 小时窗口剩余时长 + window 标签
  - 7 天窗口在 `sevenDayThreshold` 触发时附加：`| ███░░ 23% (2d 5h / 7d)`

### 可选行（通过 `/claude-hud:configure` 启用）
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← 工具活动
◐ explore [haiku]: 查找认证代码（2分15秒）       ← Agent 状态
▸ 修复认证漏洞（2/5）                             ← 待办进度
```

---

## 工作原理

Claude HUD 使用 Claude Code 原生的 **statusline API**——无需独立窗口，不需要 tmux，在任何终端都能工作。

```
Claude Code → stdin JSON → claude-hud → stdout → 在终端中显示
           ↘ transcript JSONL（工具、Agent、待办）
```

**核心特性：**
- 来自 Claude Code 的原生 Token 数据（非估算）
- 适配 Claude Code 报告的上下文窗口大小，包括最新的 1M 上下文会话
- 解析转录文件以获取工具/Agent 活动
- 约每 300ms 更新一次

---

## 配置

随时自定义你的 HUD：

```
/claude-hud:configure
```

引导式配置涵盖布局、语言和常用显示开关。高级选项如自定义颜色和阈值仍然保留，但你需要直接编辑配置文件来设置它们：

- **首次设置**：选择预设（完整/核心/极简），选择标签语言，然后微调各个元素
- **随时自定义**：开关各项、调整 Git 显示样式、切换布局或更改标签语言
- **保存前预览**：在提交更改前精确预览 HUD 的效果

### 预设

| 预设 | 显示内容 |
|------|----------|
| **完整（Full）** | 全部启用——工具、Agent、待办、Git、使用率、时长 |
| **核心（Essential）** | 活动行 + Git 状态，减少信息冗余 |
| **极简（Minimal）** | 仅核心——只有模型名称和上下文进度条 |

选择预设后，你可以单独开启或关闭各个元素。

### 手动配置

直接编辑 `~/.claude/plugins/claude-hud/config.json` 来配置高级选项，如 `colors.*`、`pathLevels`、阈值覆盖、`display.timeFormat` 以及 `display.promptCacheTtlSeconds`。运行 `/claude-hud:configure` 时会保留这些手动设置，同时你仍可更改 `language`、布局和常用引导式开关。

中文 HUD 标签作为显式 opt-in 选项提供。除非你在 `/claude-hud:configure` 中选择 `中文` 或在配置中设置 `language`，否则默认使用英文。

### 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | `en` \| `zh` | `en` | HUD 标签语言。默认为英文；设为 `zh` 启用中文标签 |
| `lineLayout` | string | `expanded` | 布局：`expanded`（多行）或 `compact`（单行） |
| `pathLevels` | 1-3 | 1 | 项目路径显示的目录层级数 |
| `elementOrder` | string[] | `["project","context","usage","promptCache","memory","environment","tools","agents","todos"]` | 展开模式下元素的顺序。省略的条目在展开模式下隐藏 |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | 展开模式下相邻时应共享一行的元素分组。设为 `[]` 可禁用合并行 |
| `gitStatus.enabled` | boolean | true | 在 HUD 中显示 git 分支 |
| `gitStatus.showDirty` | boolean | true | 显示 `*` 表示未提交的更改 |
| `gitStatus.showAheadBehind` | boolean | false | 显示 `↑N ↓N` 表示领先/落后远程的提交数 |
| `gitStatus.pushWarningThreshold` | number | 0 | 当未推送提交数达到此值时，用警告色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.pushCriticalThreshold` | number | 0 | 当未推送提交数达到此值时，用严重色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.showFileStats` | boolean | false | 显示文件变更数量 `!M +A ✘D ?U` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | 保持当前截断行为，或在可能时让 git 块以自己的换行边界单独换到下一行 |
| `display.showModel` | boolean | true | 显示模型名称 `[Opus]` |
| `display.showContextBar` | boolean | true | 显示可视化上下文进度条 `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | 上下文显示格式（`45%`、`45k/200k`、剩余 `55%` 或 `45% (45k/200k)`） |
| `display.showConfigCounts` | boolean | false | 显示 CLAUDE.md、rules、MCPs、hooks 数量 |
| `display.showCost` | boolean | false | 使用 Claude Code 原生提供的 `cost.total_cost_usd` 显示会话费用（可用时），并附带本地估算回退方案 |
| `display.showOutputStyle` | boolean | false | 从配置文件显示当前 Claude Code `outputStyle`，格式为 `style: <名称>` |
| `display.showDuration` | boolean | false | 显示会话时长 `⏱️ 5m` |
| `display.showSpeed` | boolean | false | 显示输出 Token 速度 `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | 显示 Claude 订阅用户的使用率限制（可用时） |
| `display.usageBarEnabled` | boolean | true | 将使用率显示为可视化进度条而非文本 |
| `display.timeFormat` | `relative` \| `absolute` \| `both` | `relative` | 控制使用率重置时间的显示方式：仅倒计时（`resets in 2h 30m`）、显示墙钟时间（`resets at 14:30`），或同时显示两者（`resets in 2h 30m, at 14:30`） |
| `display.sevenDayThreshold` | 0-100 | 80 | 当 7 天使用率 ≥ 阈值时显示（0 = 始终显示） |
| `display.externalUsagePath` | string | `""` | 可选的本地使用率快照文件路径，仅在 stdin `rate_limits` 缺失时使用 |
| `display.externalUsageFreshnessMs` | number | `300000` | 外部使用率快照允许的最长存活时间，超时后会被忽略 |
| `display.showTokenBreakdown` | boolean | true | 在高上下文时（85%+）显示 Token 详情 |
| `display.showTools` | boolean | false | 显示工具活动行 |
| `display.showAgents` | boolean | false | 显示 Agent 活动行 |
| `display.showTodos` | boolean | false | 显示待办进度行 |
| `display.showSessionName` | boolean | false | 显示会话 slug 或 `/rename` 设置的自定义标题 |
| `display.showClaudeCodeVersion` | boolean | false | 显示已安装的 Claude Code 版本，如 `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | 在展开布局中显示近似系统 RAM 使用行 |
| `display.showPromptCache` | boolean | false | 根据 transcript 中最后一次 assistant 响应时间显示 prompt cache 倒计时 |
| `display.promptCacheTtlSeconds` | number | `300` | Prompt cache TTL 秒数。Pro 保持默认值，Max 可设为 `3600` |
| `colors.context` | 颜色值 | `green` | 上下文进度条和百分比的基础颜色 |
| `colors.usage` | 颜色值 | `brightBlue` | 使用率进度条和低于警告阈值时百分比的颜色 |
| `colors.warning` | 颜色值 | `yellow` | 上下文阈值和使用率警告文本的警告颜色 |
| `colors.usageWarning` | 颜色值 | `brightMagenta` | 使用率进度条和接近阈值时百分比的警告颜色 |
| `colors.critical` | 颜色值 | `red` | 达到限制状态和严重阈值的颜色 |
| `colors.model` | 颜色值 | `cyan` | 模型徽章颜色，如 `[Opus]` |
| `colors.project` | 颜色值 | `yellow` | 项目路径的颜色 |
| `colors.git` | 颜色值 | `magenta` | Git 包装文本的颜色，如 `git:(` 和 `)` |
| `colors.gitBranch` | 颜色值 | `cyan` | Git 分支和分支状态文本的颜色 |
| `colors.label` | 颜色值 | `dim` | 标签和次要元数据的颜色，如 `Context`、`Usage`、计数和进度文本 |
| `colors.custom` | 颜色值 | `208` | 可选自定义行的颜色 |

支持的颜色名称：`dim`、`red`、`green`、`yellow`、`magenta`、`cyan`、`brightBlue`、`brightMagenta`。你也可以使用 256 色数字（`0-255`）或十六进制（`#rrggbb`）。

`display.showMemoryUsage` 为完全 opt-in 选项，仅在 `expanded` 布局下渲染。它报告本地机器的近似系统 RAM 使用情况，而非 Claude Code 或特定进程内的精确内存压力。由于可回收的 OS 缓存缓冲区仍可能被计入已用内存，该数字可能高估实际压力。

`display.showCost` 为完全 opt-in 选项。ClaudeHUD 优先使用 Claude Code 在 stdin 上提供的原生 `cost.total_cost_usd` 字段（可用时）。如果该字段缺失或对直连 Anthropic 会话无效，ClaudeHUD 会回退到现有的基于本地转录文件的估算方案，确保费用行在旧负载下仍能工作。原生字段在会话中首个 API 响应之前为空，因此费用显示可能在响应到达前保持隐藏。对于已知的路由提供商（如 Bedrock、Vertex AI），ClaudeHUD 也会隐藏费用显示，因为云提供商计费会话可能报告 `$0.00` 或省略该字段，即使会话并非真正免费。

`display.showPromptCache` 为完全 opt-in 选项。启用后，ClaudeHUD 会读取本地 transcript 中最后一次 assistant 响应的时间戳，并显示距离 prompt cache 过期还剩多久。默认 TTL 为 5 分钟（`300` 秒）。如果你想按 1 小时的 Max 风格窗口显示，可将 `display.promptCacheTtlSeconds` 设为 `3600`。如果 transcript 里还没有 assistant 时间戳，这个元素会继续隐藏。

### 使用率限制

当 Claude Code 在 stdin 上提供订阅用户 `rate_limits` 数据时，使用率显示**默认启用**。它会在第 2 行 alongside 上下文进度条显示你的使用率消耗。

ClaudeHUD 优先使用官方 statusline stdin 负载中的使用率数据。如果 `rate_limits` 缺失，你可以通过 `display.externalUsagePath` 显式启用本地 sidecar 快照回退，例如让代理程序写入 JSON 文件。只要 stdin 和 sidecar 同时存在，stdin 始终优先。

回退快照必须足够新（由 `display.externalUsageFreshnessMs` 控制），并且包含有效的 `updated_at`、`five_hour` 和/或 `seven_day` 字段。非法 JSON、过期文件或非法时间戳都会被静默忽略。

免费/仅限每周账户会单独显示每周窗口，而不是显示幽灵 `5h: --` 占位符。

当 7 天使用率超过 `display.sevenDayThreshold`（默认 80%）时会显示：

```
上下文 █████░░░░░ 45% │ 使用率 ██░░░░░░░░ 25%（1小时30分 / 5小时）| ██████████ 85%（2天 / 7天）
```

如需禁用，请将 `display.showUsage` 设为 `false`。

重置时间默认显示为相对倒计时。将 `display.timeFormat` 设为 `absolute` 可显示墙钟时间，设为 `both` 可同时显示两种形式。该设置目前只能手动编辑；`/claude-hud:configure` 会保留它，但不会修改它。

**前提条件：**
- Claude Code 必须在当前会话的 stdin 上包含订阅用户 `rate_limits` 数据
- 不适用于仅使用 API 密钥的用户

**故障排查：** 如果使用率不显示：
- 确保你已使用 Claude 订阅账户登录（而非 API 密钥）
- 检查配置中的 `display.showUsage` 未设为 `false`
- API 用户看不到使用率显示（他们按 Token 付费，没有使用率限制）
- AWS Bedrock 模型显示 `Bedrock` 并隐藏使用率限制（使用率由 AWS 管理）
- Google Vertex AI 模型显示 `Vertex` 并隐藏费用估算（定价与 Anthropic 直连不同）
- Claude Code 可能在会话中首个模型响应之前将 `rate_limits` 留空
- 某些 Claude Code 构建版本和订阅层级即使在首个响应之后仍可能省略 `rate_limits`
- 如果你配置了 `display.externalUsagePath`，ClaudeHUD 会先尝试读取该本地快照，再决定是否隐藏使用率
- ClaudeHUD 不会回退到凭据抓取或未记录的 API 调用

回退快照示例：

```json
{
  "updated_at": "2026-04-20T12:00:00.000Z",
  "five_hour": {
    "used_percentage": 42,
    "resets_at": "2026-04-20T15:00:00.000Z"
  },
  "seven_day": {
    "used_percentage": 84,
    "resets_at": "2026-04-27T12:00:00.000Z"
  }
}
```

### 配置示例

```json
{
  "language": "zh",
  "lineLayout": "expanded",
  "pathLevels": 2,
  "elementOrder": ["project", "tools", "context", "usage", "memory", "environment", "agents", "todos"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true,
    "showFileStats": true
  },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showConfigCounts": true,
    "showDuration": true,
    "showMemoryUsage": true
  },
  "colors": {
    "context": "cyan",
    "usage": "cyan",
    "warning": "yellow",
    "usageWarning": "magenta",
    "critical": "red",
    "model": "cyan",
    "project": "yellow",
    "git": "magenta",
    "gitBranch": "cyan",
    "label": "dim",
    "custom": "#FF6600"
  }
}
```

### 显示示例

**1 级（默认）：** `[Opus] │ my-project git:(main)`

**2 级：** `[Opus] │ apps/my-project git:(main)`

**3 级：** `[Opus] │ dev/apps/my-project git:(main)`

**带脏状态指示器：** `[Opus] │ my-project git:(main*)`

**带领先/落后：** `[Opus] │ my-project git:(main ↑2 ↓1)`

**带文件统计：** `[Opus] │ my-project git:(main* !3 +1 ?2)`
- `!` = 修改的文件，`+` = 新增/暂存，`✘` = 删除，`?` = 未跟踪
- 计数为 0 的项会被省略，以保持显示整洁

### 故障排查

**配置不生效？**
- 检查 JSON 语法错误：无效的 JSON 会静默回退到默认值
- 确保值有效：`pathLevels` 必须是 1、2 或 3；`lineLayout` 必须是 `expanded` 或 `compact`
- 删除配置文件并运行 `/claude-hud:configure` 重新生成

**Git 状态缺失？**
- 验证你是否在 git 仓库中
- 检查配置中的 `gitStatus.enabled` 不为 `false`

**工具/Agent/待办行缺失？**
- 这些默认隐藏——在配置中通过 `showTools`、`showAgents`、`showTodos` 启用
- 它们也仅在有活动可显示时才会出现

**HUD 设置后不显示？**
- 重启 Claude Code 以加载新的 statusLine 配置
- 在 macOS 上，完全退出 Claude Code 并在终端中再次运行 `claude`

---

## 运行环境要求

- Claude Code v1.0.80+
- macOS/Linux：Node.js 18+ 或 Bun
- Windows：Node.js 18+

---

## 开发

```bash
git clone https://github.com/Heartcoolman/claude-hud
cd claude-hud
npm ci && npm run build
npm test
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)

---

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=Heartcoolman/claude-hud&type=Date)](https://star-history.com/#Heartcoolman/claude-hud&Date)
