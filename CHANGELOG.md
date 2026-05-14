# Changelog

All notable changes to Claude HUD will be documented in this file.

## [Unreleased]

### Synced from upstream (jarrodwatts/claude-hud, post-0.0.12)
- feat: `balance_label` support for third-party model usage display (#541).
- feat: session start date + last response timestamp display, new `sessionTime` HudElement (#537).
- feat: `remaining` mode for usage value (#536).
- fix: `git status` octal-escaped unicode paths rendered as garbled text (#543).
- fix: invalidate stale transcript agent cache; use queue-operation timestamps for accurate background agent duration (#515).
- fix: Windows + PowerShell `/claude-hud:setup` writes a `statusline.ps1` wrapper with guarded width fallback and corrected version-directory glob (#521, #538).
- fix: detect `OSTYPE=msys` on win32 to use Git Bash command format (#532).
- Added Windows PowerShell 5.1 guidance for writing `settings.json` without a UTF-8 BOM.

## [0.2.0] - 2026-05-10

## [0.0.12] - 2026-04-04

### Added (Heartcoolman fork)

> ⚠️ **Windows path is unverified.** macOS has been exercised end-to-end;
> Windows code paths (PowerShell `CredWriteW` / `CredReadW`, Chrome DPAPI
> cookie decrypt) were implemented and reviewed but **not run on a real
> Windows host** — no Windows test environment is available to the maintainer.

- **ReClaude carpool quota integration** — separate `ReClaude` statusline element
  rendering the [reclaude.ai](https://reclaude.ai) carpool 5h cap as two
  progress bars: USD spend (`$ used/$ quota`) and time-elapsed in the rolling
  5h window (`⏱ Xh Ym / 5h`). New `proxy` HudElement, by default rendered on
  its own line below `Context | Usage`.
- Multi-tier cookie auto-refresh on 401 (macOS and Windows):
  1. Cached cookie from config
  2. Chrome cookie store decrypt (`v10`/`v11`, PBKDF2 + AES-128-CBC, strips
     32-byte SHA-256 prefix introduced in Chrome 130+)
  3. POST credentials to `/api/auth/login`, password retrieved from macOS
     Keychain (`security` CLI) or Windows Credential Manager (PowerShell
     `CredReadW` against target `claude-hud-reclaude:<email>`); 5-min cooldown
     on persistent 401
  4. `*.error` sentinel file → renderer shows `ReClaude ⚠ login required`
- Atomic config rotation: new `rc_sid` is written back to user config.json
  preserving every other field.
- `/claude-hud:reclaude-setup` interactive slash command guiding email entry,
  native credential storage, config merge, and first-fetch verification.
- `scripts/set-reclaude-password.sh` macOS helper that wraps
  `security add-generic-password` with the right service name.
- `scripts/set-reclaude-password.ps1` Windows helper that prompts silently for
  the password and stores it in Windows Credential Manager via `CredWriteW`
  (Generic credential, target `claude-hud-reclaude:<email>`).
- New i18n entry `status.loginRequired` (en: "login required", zh: "需重新登录").

### Changed (Heartcoolman fork)
- Bar-mode usage line uses tighter `(38m / 5h)` format instead of
  `(resets in 38m)`, matching session-line compact mode. Outer `Weekly`
  label hidden in normal width, restored when narrow-terminal stacking
  forces alignment.
- 7d window now shows `7d` inside the parens (e.g. `(2d 5h / 7d)`) while
  preserving the `Weekly` translation in text-only and stacked modes.
- Default `cacheTTLMs` raised from 30 s → 60 s (one fetch per minute) and
  `maxStaleMs` raised from 5 min → 10 min.
- `proxy-usage.ts::resolveFetcherPath` now picks `.ts` vs `.js` based on the
  current module extension, so the fetcher works under both `bun src/` and
  `node dist/`.
