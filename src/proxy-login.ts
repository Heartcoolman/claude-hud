/**
 * Credential-based login (Tier 3 of cookie auto-refresh).
 *
 * POST email + password to reclaude.ai's auth endpoint, parse the Set-Cookie
 * response, return the rc_sid value.
 *
 * Security:
 *   - Password comes from macOS Keychain via `security` CLI (never stored
 *     in config.json, never written to disk by claude-hud).
 *   - Failed logins use a 5-minute cooldown to avoid hammering the API on
 *     persistent 401 (e.g. expired password).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const LOGIN_URL = 'https://reclaude.ai/api/auth/login';
const KEYCHAIN_TIMEOUT_MS = 8_000;
const COOLDOWN_FILE = 'reclaude-login-cooldown';
const COOLDOWN_MS = 5 * 60_000;

async function getKeychainPassword(
  service: string,
  account: string,
): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileP(
      'security',
      ['find-generic-password', '-wga', account, '-s', service],
      { timeout: KEYCHAIN_TIMEOUT_MS },
    );
    const pwd = stdout.replace(/\n$/, '');
    return pwd || null;
  } catch {
    return null;
  }
}

function parseRcSidFromSetCookie(setCookieHeaders: string[] | string): string | null {
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const header of headers) {
    if (!header) continue;
    // Set-Cookie may chain multiple cookies separated by comma in some servers;
    // split conservatively by ", " before "key=" boundary if the comma is inside
    // an Expires date this still works because we only look for rc_sid prefix.
    const candidates = header.split(/,(?=\s*[A-Za-z0-9_]+=)/);
    for (const candidate of candidates) {
      const m = /(?:^|\s)rc_sid=([^;]+)/.exec(candidate);
      if (m) return m[1].trim();
    }
  }
  return null;
}

function cooldownPath(cacheDir: string): string {
  return path.join(cacheDir, COOLDOWN_FILE);
}

function isInCooldown(cacheDir: string, now: number): boolean {
  try {
    const stat = fs.statSync(cooldownPath(cacheDir));
    return now - stat.mtimeMs < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function setCooldown(cacheDir: string): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cooldownPath(cacheDir), String(Date.now()));
  } catch { /* ignore */ }
}

function clearCooldown(cacheDir: string): void {
  try { fs.unlinkSync(cooldownPath(cacheDir)); } catch { /* ignore */ }
}

export interface LoginAttemptInput {
  email: string;
  passwordKeychainService: string;
  cacheDir: string;
  timeoutMs: number;
  now?: number;
}

/**
 * Attempt one login. Returns the new rc_sid value on success, or null.
 * Honours and updates a cooldown file to throttle repeated 401s.
 */
export async function loginAndExtractRcSid(
  input: LoginAttemptInput,
): Promise<string | null> {
  const now = input.now ?? Date.now();
  if (!input.email) return null;
  if (isInCooldown(input.cacheDir, now)) return null;

  const password = await getKeychainPassword(input.passwordKeychainService, input.email);
  if (!password) {
    setCooldown(input.cacheDir);
    return null;
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      res = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'claude-hud-fetcher/0.1',
        },
        body: JSON.stringify({ email: input.email, password }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null; // network errors don't trip cooldown — could be transient
  }

  if (!res.ok) {
    if (res.status === 401) setCooldown(input.cacheDir);
    return null;
  }

  // Node's fetch exposes Set-Cookie via raw headers iteration.
  const rawSetCookie: string[] = [];
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase() === 'set-cookie') rawSetCookie.push(v);
  }
  const rcSid = parseRcSidFromSetCookie(rawSetCookie);
  if (rcSid) {
    clearCooldown(input.cacheDir);
    return rcSid;
  }

  return null;
}
