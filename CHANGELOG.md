# Changelog

All notable changes to Claude HUD will be documented in this file.

## [Unreleased]

### Changed (Heartcoolman fork)
- Default `elementOrder` no longer includes `usage`; `proxy` (ReClaude) moves
  in right after `context`. Users who want Anthropic-native rate limits
  back can add `"usage"` to `elementOrder` in their config.
- `addedDirs` moved to sit after `context` (was between `project` and
  `context`) so the default `mergeGroups` can fuse project+context — merge
  requires adjacency in `elementOrder`. Only affects users who set
  `display.addedDirsLayout = 'line'`; inline (default) rendering is
  unchanged.
- Default `mergeGroups` is now `[["project", "context"]]` (was
  `[["context", "usage"]]`). The context bar attaches to the project line;
  ReClaude (when enabled) renders on its own left-aligned line below.
- `KNOWN_ELEMENTS` decoupled from `DEFAULT_ELEMENT_ORDER` so `usage`
  remains addressable in user configs even though it is no longer in the
  default order. No migration required for existing configs — explicit
  `elementOrder` / `mergeGroups` values are preserved verbatim.

## [0.2.1] - 2026-05-14

Patch release that pulls in 30 upstream commits (`70ecdbf..6f7d073` from
`jarrodwatts/claude-hud:main`, post-0.0.12) on top of the fork's 0.2.0
ReClaude integration. Verified end-to-end after merge:
`balance_label` swaps the Usage percentage for the raw third-party label;
`usageValue: 'remaining'` flips 25 % used → 75 % shown; opted-in
`sessionTime` renders `Started: … │ Last reply: Xm ago`; default-off
behavior unchanged for existing users.

### Added (from upstream)
- `balance_label` field support on the external-usage snapshot for
  third-party model usage display (#541).
- `sessionTime` HudElement showing session start date and last response
  timestamp, opt-in via `display.showSessionStartDate` /
  `display.showLastResponseAt` (#537).
- `display.usageValue: 'remaining'` mode that renders the unused portion
  of the rate-limit window instead of the consumed portion (#536).

### Fixed (from upstream)
- `git status` octal-escaped unicode paths rendered as garbled text (#543).
- Stale transcript agent cache + background agent duration computed from
  queue-operation timestamps instead of wall clock (#515).
- Windows + PowerShell `/claude-hud:setup` now writes a `statusline.ps1`
  wrapper with a guarded width fallback and corrected version-directory
  glob (#521, #538).
- win32 with `OSTYPE=msys` now routes through Git Bash command format
  instead of native PowerShell (#532).

### Changed (Heartcoolman fork)
- `HudElement` union widened to include both `proxy` (fork) and
  `sessionTime` (upstream); `DEFAULT_ELEMENT_ORDER` extended accordingly.
- `package-lock.json` version field synced to `0.2.1` (was lagging at
  `0.1.0` since the 0.2.0 cut).

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
