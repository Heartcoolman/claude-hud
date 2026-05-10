import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { HudConfig } from './config.js';
import { getConfigPath } from './config.js';
import type { ProxyUsageData } from './types.js';

/** Stale-lock threshold — past this, assume the previous fetcher crashed. */
const LOCK_TIMEOUT_MS = 30_000;

/** Window during which an auth-error sentinel is honoured for rendering. */
const SENTINEL_FRESH_MS = 10 * 60_000;

/**
 * Resolve fetcher path next to this module, matching the current extension.
 * - Node running compiled dist → `proxy-usage-fetcher.js`
 * - Bun running source directly → `proxy-usage-fetcher.ts`
 */
function resolveFetcherPath(): string {
  const here = fileURLToPath(import.meta.url);
  const ext = path.extname(here) || '.js';
  return path.join(path.dirname(here), `proxy-usage-fetcher${ext}`);
}

interface CacheSnapshot {
  used_usd?: string | number;
  quota_usd?: string | number;
  resets_at_ms?: number;
  enabled?: boolean;
  status?: string;
  fetched_at?: number;
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Read the cached reclaude.ai carpool quota and compute display fields.
 *
 * Side-effect: when the cache is stale (older than `cacheTTLMs`) or missing,
 * spawns a detached background fetcher and returns whatever cached data we
 * have right now (or null). The next statusline tick will see fresh data.
 *
 * Returns null when:
 *   - feature disabled or no cookie configured
 *   - cache absent (first run / never fetched)
 *   - cache older than `maxStaleMs`
 *   - upstream reports `enabled: false` or `status !== "active"`
 *   - quota_usd is non-positive or unparseable
 */
export function getProxyUsage(
  config: HudConfig,
  now: number = Date.now(),
): ProxyUsageData | null {
  const cfg = config.display.reclaude;
  if (!cfg.enabled) return null;
  // Allow proceeding without a cookie when auto-refresh credentials are set;
  // Tier 3 of the fetcher can obtain one from email+Keychain.
  const canRefreshFromCredentials =
    (cfg.cookieAutoRefresh === 'credentials' || cfg.cookieAutoRefresh === 'chrome+credentials') &&
    cfg.email !== '';
  const canRefreshFromChrome =
    (cfg.cookieAutoRefresh === 'chrome' || cfg.cookieAutoRefresh === 'chrome+credentials') &&
    (process.platform === 'darwin' || process.platform === 'win32');
  if (!cfg.cookie && !canRefreshFromCredentials && !canRefreshFromChrome) return null;

  const cachePath = expandHome(cfg.cachePath);

  let snap: CacheSnapshot | null = null;
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    snap = JSON.parse(raw) as CacheSnapshot;
  } catch {
    /* missing/corrupt — fall through to maybeKickFetch */
  }

  const fetchedAt = typeof snap?.fetched_at === 'number' ? snap.fetched_at : 0;
  const isFresh = snap !== null && now - fetchedAt < cfg.cacheTTLMs;

  if (!isFresh) maybeKickFetch(cfg, cachePath, now);

  if (!snap) return null;
  if (now - fetchedAt > cfg.maxStaleMs) return null;
  if (snap.enabled === false) return null;
  if (typeof snap.status === 'string' && snap.status !== 'active') return null;

  const usedUsd = parseAmount(snap.used_usd);
  const quotaUsd = parseAmount(snap.quota_usd);
  if (!Number.isFinite(usedUsd) || !Number.isFinite(quotaUsd) || quotaUsd <= 0) {
    return null;
  }

  const percent = Math.max(
    0,
    Math.min(100, Math.round((usedUsd / quotaUsd) * 100)),
  );
  const resetAt =
    typeof snap.resets_at_ms === 'number' &&
    Number.isFinite(snap.resets_at_ms) &&
    snap.resets_at_ms > 0
      ? new Date(snap.resets_at_ms)
      : null;

  return { usedUsd, quotaUsd, percent, resetAt, fetchedAt };
}

interface SentinelFile {
  code?: string;
  at?: number;
}

/**
 * Returns 'login_required' when a recent auth-error sentinel is present.
 * Returns null when there's no sentinel, it's stale, or feature disabled.
 */
export function getProxyAuthStatus(
  config: HudConfig,
  now: number = Date.now(),
): 'login_required' | null {
  const cfg = config.display.reclaude;
  if (!cfg.enabled) return null;

  const sentinelPath = `${expandHome(cfg.cachePath)}.error`;
  let sentinel: SentinelFile | null = null;
  try {
    sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf8')) as SentinelFile;
  } catch {
    return null;
  }
  if (!sentinel || typeof sentinel.at !== 'number') return null;
  if (now - sentinel.at > SENTINEL_FRESH_MS) return null;
  if (sentinel.code === 'login_required') return 'login_required';
  return null;
}

function maybeKickFetch(
  cfg: HudConfig['display']['reclaude'],
  cachePath: string,
  now: number,
): void {
  const lockPath = `${cachePath}.lock`;

  try {
    const lockMtime = fs.statSync(lockPath).mtimeMs;
    if (now - lockMtime < LOCK_TIMEOUT_MS) return; // another fetch in flight
    // Stale lock — clear it before re-acquiring (best-effort).
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  } catch {
    /* no lock — proceed */
  }

  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    // 'wx' = exclusive create; if another process won the race, this throws
    // and we bail (their fetcher will populate the cache).
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try { fs.writeFileSync(fd, String(now)); } finally { fs.closeSync(fd); }
  } catch {
    return;
  }

  try {
    const fetcherPath = resolveFetcherPath();
    // Secrets (cookie, email, keychain service name) are passed via env vars
    // rather than argv so they don't appear in the system process table
    // (Task Manager / `ps -ef` / wmic).
    const child = spawn(
      process.execPath,
      [
        fetcherPath,
        '--url', cfg.apiUrl,
        '--cache', cachePath,
        '--lock', lockPath,
        '--timeout-ms', String(cfg.fetchTimeoutMs),
        '--config', getConfigPath(),
        '--auto-refresh', cfg.cookieAutoRefresh,
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          CLAUDE_HUD_RECLAUDE_COOKIE: cfg.cookie,
          CLAUDE_HUD_RECLAUDE_EMAIL: cfg.email,
          CLAUDE_HUD_RECLAUDE_KEYCHAIN: cfg.passwordKeychainService,
        },
      },
    );
    child.unref();
  } catch {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
}
