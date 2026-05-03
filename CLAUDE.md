# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Claude HUD is a Claude Code plugin that displays a real-time multi-line statusline. It shows context health, tool activity, agent status, and todo progress.

## Build Commands

```bash
npm ci               # Install dependencies
npm run build        # Build TypeScript to dist/

# Test with sample stdin data
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000}}' | node dist/index.js
```

## Architecture

### Data Flow

```
Claude Code → stdin JSON → parse → render lines → stdout → Claude Code displays
           ↘ transcript_path → parse JSONL → tools/agents/todos
```

**Key insight**: The statusline is invoked every ~300ms by Claude Code. Each invocation:
1. Receives JSON via stdin (model, context, tokens - native accurate data)
2. Parses the transcript JSONL file for tools, agents, and todos
3. Renders multi-line output to stdout
4. Claude Code displays all lines

### Data Sources

**Native from stdin JSON** (accurate, no estimation):
- `model.display_name` - Current model
- `context_window.current_usage` - Token counts
- `context_window.context_window_size` - Max context
- `transcript_path` - Path to session transcript

**From transcript JSONL parsing**:
- `tool_use` blocks → tool name, input, start time
- `tool_result` blocks → completion, duration
- Running tools = `tool_use` without matching `tool_result`
- `TodoWrite` calls → todo list
- `Task` calls → agent info

**From config files**:
- MCP count from `~/.claude/settings.json` (mcpServers)
- Hooks count from `~/.claude/settings.json` (hooks)
- Rules count from CLAUDE.md files

**From Claude Code stdin rate limits**:
- `rate_limits.five_hour.used_percentage` - 5-hour subscriber usage percentage
- `rate_limits.five_hour.resets_at` - 5-hour reset timestamp
- `rate_limits.seven_day.used_percentage` - 7-day subscriber usage percentage
- `rate_limits.seven_day.resets_at` - 7-day reset timestamp

**From reclaude.ai carpool quota API** (this fork's addition):
- `display.reclaude.enabled` opt-in. Cached at `~/.cache/claude-hud/reclaude-quota.json`.
- `GET /api/app/billing/carpool-quota` with `Cookie: rc_sid=...` →
  `used_usd`, `quota_usd`, `resets_at_ms`, `enabled`, `status`.
- Background fetcher (`proxy-usage-fetcher.ts`) is spawned **detached** every
  60 s when stale; never blocks the statusline render.
- On 401: multi-tier auto-refresh (macOS only):
  1. cached cookie → 2. Chrome cookie store decrypt (PBKDF2 + AES-128-CBC,
     handles Chrome 130+ 32-byte SHA-256 prefix) → 3. POST credentials to
     `/api/auth/login` (password from macOS Keychain via `security` CLI) →
     4. write `*.error` sentinel → renderer shows `⚠ login required`.
- Successful auth rotates the new `rc_sid` atomically into user `config.json`.

### File Structure

```
src/
├── index.ts                  # Entry point
├── stdin.ts                  # Parse Claude's JSON input
├── transcript.ts             # Parse transcript JSONL
├── config-reader.ts          # Read MCP/rules configs
├── config.ts                 # Load/validate user config (incl. display.reclaude)
├── git.ts                    # Git status (branch, dirty, ahead/behind)
├── types.ts                  # TypeScript interfaces (incl. ProxyUsageData)
├── external-usage.ts         # Fallback usage snapshot file reader
├── proxy-usage.ts            # ReClaude cache reader + background fetch trigger
├── proxy-usage-fetcher.ts    # Detached subprocess: multi-tier fetch + cookie rotate
├── proxy-chrome-cookie.ts    # macOS Chrome cookie store decrypt (Tier 2)
├── proxy-login.ts            # POST /api/auth/login + Keychain password (Tier 3)
├── proxy-config-update.ts    # Atomic write of rotated rc_sid back into config.json
└── render/
    ├── index.ts              # Main render coordinator
    ├── session-line.ts       # Compact mode: single line with all info
    ├── tools-line.ts         # Tool activity (opt-in)
    ├── agents-line.ts        # Agent status (opt-in)
    ├── todos-line.ts         # Todo progress (opt-in)
    ├── colors.ts             # ANSI color helpers
    └── lines/
        ├── index.ts          # Barrel export
        ├── project.ts        # Line 1: model bracket + project + git
        ├── identity.ts       # Line 2a: context bar
        ├── usage.ts          # Line 2b: usage bar (combined with identity)
        ├── proxy.ts          # Line 2c: ReClaude $ + ⏱ dual progress bars
        └── environment.ts    # Config counts (opt-in)
```

**HudElement enum order (`src/config.ts`)**: `project | context | usage | proxy
| promptCache | memory | environment | tools | agents | todos`. Default
`mergeGroups: [['context', 'usage']]` puts proxy on its own line below.

### Output Format (default expanded layout)

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
ReClaude $ █████░░░░░ 47% ($23.69/$50) | ⏱ ██░░░░░░░░ 21% (3h 57m / 5h)
```

Lines 1-2 always shown when their data is available. Additional lines are
opt-in via config:
- ReClaude line (`display.reclaude.enabled`): dual progress bars — money
  (`usedUsd / quotaUsd`) and time-elapsed-in-5h-window. macOS auto-refresh.
- Tools line (`showTools`): ◐ Edit: auth.ts | ✓ Read ×3
- Agents line (`showAgents`): ◐ explore [haiku]: Finding auth code
- Todos line (`showTodos`): ▸ Fix authentication bug (2/5)
- Environment line (`showConfigCounts`): 2 CLAUDE.md | 4 rules

### Context Thresholds

| Threshold | Color | Action |
|-----------|-------|--------|
| <70% | Green | Normal |
| 70-85% | Yellow | Warning |
| >85% | Red | Show token breakdown |

## Plugin Configuration

The plugin manifest is in `.claude-plugin/plugin.json` (metadata only - name, description, version, author).

**StatusLine configuration** must be added to the user's `~/.claude/settings.json` via `/claude-hud:setup`.

The setup command adds an auto-updating command that finds the latest installed version at runtime.

Note: `statusLine` is NOT a valid plugin.json field. It must be configured in settings.json after plugin installation. Updates are automatic - no need to re-run setup.

## Dependencies

- **Runtime**: Node.js 18+ or Bun
- **Build**: TypeScript 5, ES2022 target, NodeNext modules
