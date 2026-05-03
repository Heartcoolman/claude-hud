/**
 * Atomic update of `display.reclaude.cookie` in the user config file.
 *
 * Reads the live JSON, mutates only the cookie field (preserving every other
 * key, including unknown ones written by other tools), and rewrites via
 * `.tmp` + `rename`. File mode is preserved when possible.
 *
 * Best-effort: on any error, returns false. Caller continues without rotation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

interface AnyObj { [k: string]: unknown }

function isObject(value: unknown): value is AnyObj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function updateReclaudeCookieInConfig(
  configPath: string,
  rcSidValue: string,
): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return false;
  }

  let parsed: AnyObj;
  try {
    const obj = JSON.parse(raw);
    if (!isObject(obj)) return false;
    parsed = obj;
  } catch {
    return false;
  }

  if (!isObject(parsed.display)) parsed.display = {};
  const display = parsed.display as AnyObj;
  if (!isObject(display.reclaude)) display.reclaude = {};
  const reclaude = display.reclaude as AnyObj;

  const newCookie = rcSidValue.startsWith('rc_sid=') ? rcSidValue : `rc_sid=${rcSidValue}`;
  if (reclaude.cookie === newCookie) return false; // no change → no write

  reclaude.cookie = newCookie;

  let mode = 0o600;
  try {
    mode = fs.statSync(configPath).mode & 0o777;
  } catch { /* keep 600 */ }

  const tmp = `${configPath}.tmp.${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n', { mode });
    fs.renameSync(tmp, configPath);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}
