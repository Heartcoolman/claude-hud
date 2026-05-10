/**
 * Multi-tier reclaude.ai quota fetcher.
 *
 * Tier 1: try the cookie passed in via --cookie.
 * Tier 2: read fresh rc_sid from Chrome's Default profile cookie store.
 * Tier 3: POST credentials to /api/auth/login → extract Set-Cookie rc_sid.
 * Tier 4: drop a sentinel ($cache.error) so the renderer can show a warning.
 *
 * On any tier producing a 200 response, the cache is written and the
 * authoritative cookie is rotated back into the user's config.json.
 *
 * Runs as a detached child process spawned by proxy-usage.ts. Errors are
 * swallowed silently — the next statusline tick will retry.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readChromeCookie } from './proxy-chrome-cookie.js';
import { loginAndExtractRcSid } from './proxy-login.js';
import { updateReclaudeCookieInConfig } from './proxy-config-update.js';

interface FetcherArgs {
  cookie: string;
  url: string;
  cache: string;
  lock: string;
  timeoutMs: number;
  configPath: string;
  autoRefresh: 'off' | 'chrome' | 'credentials' | 'chrome+credentials';
  email: string;
  passwordKeychainService: string;
}

function parseArgs(argv: string[]): FetcherArgs {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value === undefined) continue;
    out[flag.slice(2)] = value;
    i += 1;
  }
  const timeoutMs = Number.parseInt(out['timeout-ms'] ?? '5000', 10);
  const ar = out['auto-refresh'] as FetcherArgs['autoRefresh'];
  // Secrets travel via env vars so they don't appear in the system process
  // table. `out['…']` argv fallbacks remain for the legacy / test invocation
  // path but are ignored when the env var is set.
  return {
    cookie: process.env.CLAUDE_HUD_RECLAUDE_COOKIE ?? out['cookie'] ?? '',
    url: out['url'] ?? '',
    cache: out['cache'] ?? '',
    lock: out['lock'] ?? '',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
    configPath: out['config'] ?? '',
    autoRefresh:
      ar === 'chrome' || ar === 'credentials' || ar === 'chrome+credentials' ? ar : 'off',
    email: process.env.CLAUDE_HUD_RECLAUDE_EMAIL ?? out['email'] ?? '',
    passwordKeychainService:
      process.env.CLAUDE_HUD_RECLAUDE_KEYCHAIN ?? out['keychain-service'] ?? '',
  };
}

function cleanupLock(lockPath: string): void {
  if (!lockPath) return;
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}

function sentinelPath(cachePath: string): string {
  return `${cachePath}.error`;
}

function writeSentinel(cachePath: string, code: 'login_required'): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(sentinelPath(cachePath), JSON.stringify({ code, at: Date.now() }));
  } catch { /* ignore */ }
}

function clearSentinel(cachePath: string): void {
  try { fs.unlinkSync(sentinelPath(cachePath)); } catch { /* ignore */ }
}

async function fetchQuota(
  url: string,
  cookie: string,
  timeoutMs: number,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Cookie: cookie,
          Accept: 'application/json',
          'User-Agent': 'claude-hud-fetcher/0.1',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json()) as Record<string, unknown>;
    return { ok: true, body };
  } catch {
    return { ok: false, status: null };
  }
}

function writeCacheAtomically(cachePath: string, body: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const snapshot = { ...body, fetched_at: Date.now() };
  const tmp = `${cachePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot));
  fs.renameSync(tmp, cachePath);
}

function normaliseCookie(rcSid: string): string {
  return rcSid.startsWith('rc_sid=') ? rcSid : `rc_sid=${rcSid}`;
}

async function tryTier2Chrome(args: FetcherArgs): Promise<string | null> {
  if (args.autoRefresh !== 'chrome' && args.autoRefresh !== 'chrome+credentials') return null;
  const fresh = await readChromeCookie('reclaude.ai', 'rc_sid');
  if (!fresh) return null;
  const candidate = normaliseCookie(fresh);
  if (candidate === args.cookie) return null; // same as what failed; skip
  return candidate;
}

async function tryTier3Login(args: FetcherArgs): Promise<string | null> {
  if (args.autoRefresh !== 'credentials' && args.autoRefresh !== 'chrome+credentials') return null;
  if (!args.email) return null;
  const cacheDir = path.dirname(args.cache);
  const newSid = await loginAndExtractRcSid({
    email: args.email,
    passwordKeychainService: args.passwordKeychainService,
    cacheDir,
    timeoutMs: args.timeoutMs,
  });
  if (!newSid) return null;
  return normaliseCookie(newSid);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args.url || !args.cache) {
    cleanupLock(args.lock);
    return;
  }

  try {
    // Tier 1
    let cookieToTry = args.cookie;
    let result = cookieToTry
      ? await fetchQuota(args.url, cookieToTry, args.timeoutMs)
      : { ok: false as const, status: 401 };

    // Tier 2
    if (!result.ok && result.status === 401) {
      const tier2 = await tryTier2Chrome(args);
      if (tier2) {
        const r2 = await fetchQuota(args.url, tier2, args.timeoutMs);
        if (r2.ok) {
          cookieToTry = tier2;
          result = r2;
        } else if (r2.status === 401) {
          // fall through to Tier 3
        }
      }
    }

    // Tier 3
    if (!result.ok && (result.status === 401 || !args.cookie)) {
      const tier3 = await tryTier3Login(args);
      if (tier3) {
        const r3 = await fetchQuota(args.url, tier3, args.timeoutMs);
        if (r3.ok) {
          cookieToTry = tier3;
          result = r3;
        }
      }
    }

    if (result.ok) {
      writeCacheAtomically(args.cache, result.body);
      clearSentinel(args.cache);
      // Rotate cookie back into user config when we obtained a different one.
      if (args.configPath && cookieToTry && cookieToTry !== args.cookie) {
        updateReclaudeCookieInConfig(args.configPath, cookieToTry);
      }
    } else if (result.status === 401) {
      writeSentinel(args.cache, 'login_required');
    }
    // Other failures (network, 5xx) leave existing cache + sentinel untouched.
  } catch {
    /* swallow — next tick will retry */
  } finally {
    cleanupLock(args.lock);
  }
}

void main();
