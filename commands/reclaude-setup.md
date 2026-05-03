---
description: Set up reclaude.ai carpool quota auto-refresh (macOS only)
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# Set up ReClaude carpool quota integration

Guides the user through enabling the **ReClaude** statusline segment, which
shows their reclaude.ai carpool 5h quota (USD spend + time elapsed) alongside
the native Anthropic 5h/7d limits.

> **macOS only.** This integration uses the macOS Keychain to store the
> reclaude.ai password and the `security` CLI to retrieve it. Linux/Windows
> users can still use the manual cookie path documented in the README.

## Step 0: Platform check

```bash
if [[ "$OSTYPE" != darwin* ]]; then
  echo "✗ Auto-refresh requires macOS (Keychain). On Linux/Windows, see the manual cookie setup in the README."
  exit 1
fi
echo "✓ macOS detected"
```

If non-macOS, stop and show the manual-cookie path from the README.

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

## Step 3: Store password in Keychain (user runs this in their own terminal)

The password must NEVER pass through Claude Code. Tell the user:

> Open a terminal **outside Claude Code** and run **one** of these (the script
> wraps `security add-generic-password` for you):
>
> ```bash
> # Find the latest installed plugin path:
> PLUGIN_DIR=$(ls -d ~/.claude/plugins/cache/claude-hud/claude-hud/*/ | sort -V | tail -1)
>
> # Run the helper:
> "$PLUGIN_DIR/scripts/set-reclaude-password.sh" <RECLAUDE_EMAIL>
> ```
>
> The script reads the password silently (no echo) and stores it in your macOS
> Keychain under service name `claude-hud-reclaude`.

After they say done, verify the entry exists with:
```bash
security find-generic-password -a "<RECLAUDE_EMAIL>" -s "claude-hud-reclaude" >/dev/null 2>&1 && echo "✓ Password in Keychain" || echo "✗ Not found"
```

If verification fails, tell the user to re-run the helper script.

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
waiting for the next statusline tick):

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

Then read the result:

```bash
if [ -f ~/.cache/claude-hud/reclaude-quota.json ]; then
  echo "✓ Quota fetched:"
  cat ~/.cache/claude-hud/reclaude-quota.json | python3 -m json.tool
elif [ -f ~/.cache/claude-hud/reclaude-quota.json.error ]; then
  echo "✗ Login failed. Check email + password in Keychain."
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
> - **On 401**: it automatically POSTs `email + password (from Keychain)` to
>   `/api/auth/login` and rotates the new `rc_sid` cookie back into your config.
> - **No browser interaction** required.
>
> Restart Claude Code (or wait one statusline tick) to see the ReClaude line:
>
> ```
> ReClaude $ ████░░░░░░ XX% ($Y/$Z) | ⏱ ███░░░░░░░ XX% (Xh Ym / 5h)
> ```
>
> If you want to disable it later, run:
> ```bash
> # Remove cookie + auto-refresh from config:
> # (manually edit ~/.claude/plugins/claude-hud/config.json — remove the "reclaude" block)
> security delete-generic-password -a <RECLAUDE_EMAIL> -s claude-hud-reclaude
> rm -rf ~/.cache/claude-hud
> ```

## Failure modes

If Step 5 returns `"login_required"`:
- The Keychain password may be wrong → re-run the helper from Step 3.
- The reclaude.ai account may be locked → log in via browser to verify.

If `bun` is not found, install it: `curl -fsSL https://bun.sh/install | bash`.
