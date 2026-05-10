---
description: Set up reclaude.ai carpool quota auto-refresh (macOS / Windows)
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# Set up ReClaude carpool quota integration

Guides the user through enabling the **ReClaude** statusline segment, which
shows their reclaude.ai carpool 5h quota (USD spend + time elapsed) alongside
the native Anthropic 5h/7d limits.

> **macOS and Windows supported.** This integration stores the reclaude.ai
> password in macOS Keychain or Windows Credential Manager. Linux and WSL users
> can still use the manual cookie path documented in the README.
>
> ⚠️ **Windows path is unverified.** The macOS path has been exercised
> end-to-end; the Windows path (PowerShell `CredWriteW` / `CredReadW`, Chrome
> DPAPI cookie decrypt) was implemented and reviewed in code but **has not
> been run on a real Windows host** — there is no Windows test environment
> available to the maintainer. Please file an issue at
> [Heartcoolman/claude-hud](https://github.com/Heartcoolman/claude-hud/issues)
> if anything fails on Windows.

## Step 0: Platform check

```bash
PLATFORM="unsupported"

if [[ "${OSTYPE:-}" == darwin* ]]; then
  PLATFORM="macos"
elif command -v powershell.exe >/dev/null 2>&1; then
  # Map the boolean to PS exit code so the bash `if` reflects the check.
  if powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \
    "if ([Environment]::OSVersion.Platform -eq 'Win32NT' -and (Get-Command Add-Type -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }" \
    >/dev/null 2>&1; then
    # Reject WSL: /proc/version contains 'microsoft' or 'WSL' there.
    if ! grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
      PLATFORM="windows"
    fi
  fi
fi

case "$PLATFORM" in
  macos)
    echo "✓ macOS detected; using Keychain"
    ;;
  windows)
    echo "✓ Windows detected; using Credential Manager"
    ;;
  *)
    echo "✗ Auto-refresh requires macOS Keychain or Windows Credential Manager. On Linux/WSL/unsupported shells, see the manual cookie setup in the README."
    exit 1
    ;;
esac
```

If unsupported, stop and show the manual-cookie path from the README.

## Step 1: Confirm reclaude.ai account

Use `AskUserQuestion`:

- question: "Do you already have a reclaude.ai account?"
- options:
  - "Yes — proceed" → continue
  - "No — open signup page" → run `Bash: open https://reclaude.ai/register` then stop and tell user to come back after signup

## Step 2: Collect email

Use `AskUserQuestion` (with an "Other" custom-text fallback) to ask:

- question: "What email do you log into reclaude.ai with?"
- options should include "Type custom email" — user enters their address.

Save the answer to a variable `RECLAUDE_EMAIL`.

Validate with a basic regex:
```bash
[[ "$RECLAUDE_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]] || echo "Invalid email format"
```

## Step 3: Store password in the native credential store

Follow the subsection for the platform detected in Step 0.

### Step 3 (macOS): Store password in Keychain

The password must NEVER pass through Claude Code. Tell the user:

> Open a terminal **outside Claude Code** and run this command (the script
> wraps `security add-generic-password` for you):
>
> ```bash
> # Find the latest installed plugin path:
> PLUGIN_DIR=$(ls -d ~/.claude/plugins/cache/claude-hud/claude-hud/*/ | sort -V | tail -1)
>
> # Run the macOS helper:
> "$PLUGIN_DIR/scripts/set-reclaude-password.sh" <RECLAUDE_EMAIL>
> ```
>
> The script reads the password silently (no echo) and stores it in your macOS
> Keychain under service name `claude-hud-reclaude`.

After they say done, verify the Keychain entry exists with:
```bash
security find-generic-password -a "<RECLAUDE_EMAIL>" -s "claude-hud-reclaude" >/dev/null 2>&1 && echo "✓ Password in Keychain" || echo "✗ Not found"
```

If verification fails, tell the user to re-run the helper script.

### Step 3 (Windows): Store password in Credential Manager

The password must NEVER pass through Claude Code. Tell the user:

> Open **Windows PowerShell outside Claude Code** and run this command (the
> script writes a Generic credential to Windows Credential Manager via
> `advapi32!CredWriteW`, mirroring the reader in `src/proxy-login.ts`):
>
> ```powershell
> # Find the latest installed plugin path (version-aware, so 0.10.0 sorts after 0.9.0):
> $PluginDir = Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\claude-hud\claude-hud" -Directory |
>   Sort-Object { try { [version] $_.Name } catch { [version] '0.0.0' } } |
>   Select-Object -Last 1
>
> # Run the Windows helper:
> powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$($PluginDir.FullName)\scripts\set-reclaude-password.ps1" "<RECLAUDE_EMAIL>"
> ```
>
> The script reads the password silently (no echo) and stores it in Windows
> Credential Manager as target `claude-hud-reclaude:<RECLAUDE_EMAIL>`.

After they say done, verify the Credential Manager entry exists with
(`MSYS_NO_PATHCONV=1` prevents Git Bash from rewriting the `/list:` argument
into a POSIX path):
```bash
TARGET="claude-hud-reclaude:<RECLAUDE_EMAIL>"
MSYS_NO_PATHCONV=1 cmdkey /list:"$TARGET" 2>/dev/null | grep -q "Target:" && echo "✓ Password in Credential Manager" || echo "✗ Not found"
```

If verification fails, tell the user to re-run the helper script from Windows
PowerShell outside Claude Code.

## Step 4: Update user config

Read the current config:
```bash
CONFIG="$HOME/.claude/plugins/claude-hud/config.json"
mkdir -p "$(dirname "$CONFIG")"
```

If the file does not exist, create it with `{}`. Then merge in the reclaude block.

Use `Read`, parse JSON in your head, and use `Write` to emit the merged config.
The merged content should look like:

```json
{
  "language": "en",
  "display": {
    "reclaude": {
      "enabled": true,
      "cookieAutoRefresh": "credentials",
      "email": "<RECLAUDE_EMAIL>",
      "passwordKeychainService": "claude-hud-reclaude"
    }
  }
}
```

**Preserve every other key the user already had** — do NOT overwrite their
existing `display.*` flags (showTools, showCost, etc.). Only add or replace
the `display.reclaude` subobject.

After writing, lock down permissions:
```bash
chmod 600 "$CONFIG"
```

## Step 5: Trigger the first fetch and verify

Run the fetcher synchronously to see the result immediately (instead of
waiting for the next statusline tick). The fetcher itself is platform-agnostic
— it picks Keychain or Credential Manager from `process.platform` at runtime,
so the same invocation works on both macOS and Windows.

```bash
PLUGIN_DIR=$(ls -d ~/.claude/plugins/cache/claude-hud/claude-hud/*/ | sort -V | tail -1)
mkdir -p ~/.cache/claude-hud
rm -f ~/.cache/claude-hud/reclaude-quota.json* ~/.cache/claude-hud/reclaude-login-cooldown

bun "${PLUGIN_DIR}src/proxy-usage-fetcher.ts" \
  --cookie "" \
  --url "https://reclaude.ai/api/app/billing/carpool-quota" \
  --cache "$HOME/.cache/claude-hud/reclaude-quota.json" \
  --lock "$HOME/.cache/claude-hud/reclaude-quota.json.lock" \
  --timeout-ms 8000 \
  --config "$HOME/.claude/plugins/claude-hud/config.json" \
  --auto-refresh credentials \
  --email "<RECLAUDE_EMAIL>" \
  --keychain-service "claude-hud-reclaude"
```

> **Windows without Bun**: substitute the compiled fetcher in `dist/` (no extra
> install required; same args):
>
> ```bash
> node "${PLUGIN_DIR}dist/proxy-usage-fetcher.js" \
>   --cookie "" \
>   --url "https://reclaude.ai/api/app/billing/carpool-quota" \
>   --cache "$HOME/.cache/claude-hud/reclaude-quota.json" \
>   --lock "$HOME/.cache/claude-hud/reclaude-quota.json.lock" \
>   --timeout-ms 8000 \
>   --config "$HOME/.claude/plugins/claude-hud/config.json" \
>   --auto-refresh credentials \
>   --email "<RECLAUDE_EMAIL>" \
>   --keychain-service "claude-hud-reclaude"
> ```

Then read the result:

```bash
if [ -f ~/.cache/claude-hud/reclaude-quota.json ]; then
  echo "✓ Quota fetched:"
  cat ~/.cache/claude-hud/reclaude-quota.json | python3 -m json.tool
elif [ -f ~/.cache/claude-hud/reclaude-quota.json.error ]; then
  echo "✗ Login failed. Check email + password in the credential store."
  cat ~/.cache/claude-hud/reclaude-quota.json.error
else
  echo "? No data and no error — check network and reclaude.ai status."
fi
```

## Step 6: Done message

Tell the user:

> ReClaude is now wired up:
>
> - **Auto-refresh**: every 60s, claude-hud fetches your quota in the background.
> - **On 401**: it automatically POSTs `email + password` (from Keychain or
>   Credential Manager) to `/api/auth/login` and rotates the new `rc_sid`
>   cookie back into your config.
> - **No browser interaction** required.
>
> Restart Claude Code (or wait one statusline tick) to see the ReClaude line:
>
> ```
> ReClaude $ ████░░░░░░ XX% ($Y/$Z) | ⏱ ███░░░░░░░ XX% (Xh Ym / 5h)
> ```
>
> If you want to disable it later:
> ```bash
> # 1. Remove cookie + auto-refresh from config:
> # (manually edit ~/.claude/plugins/claude-hud/config.json — remove the "reclaude" block)
>
> # 2. Forget the password:
> # macOS:
> security delete-generic-password -a <RECLAUDE_EMAIL> -s claude-hud-reclaude
> # Windows (PowerShell):
> cmdkey /delete:claude-hud-reclaude:<RECLAUDE_EMAIL>
>
> # 3. Clear caches and sentinels:
> rm -rf ~/.cache/claude-hud
> ```

## Failure modes

If Step 5 returns `"login_required"`:
- The saved password (Keychain or Credential Manager) may be wrong → re-run
  the helper from Step 3.
- The reclaude.ai account may be locked → log in via browser to verify.

If `bun` is not found, install it (`curl -fsSL https://bun.sh/install | bash`)
or use the `node "${PLUGIN_DIR}dist/proxy-usage-fetcher.js"` invocation shown
above.
