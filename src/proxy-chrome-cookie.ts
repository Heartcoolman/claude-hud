/**
 * macOS Chrome cookie reader (Tier 2 of cookie auto-refresh).
 *
 * Reads the rc_sid cookie value from Chrome's encrypted SQLite store.
 *
 * Mechanism:
 *   - Locate ~/Library/Application Support/Google/Chrome/Default/Cookies
 *   - Use sqlite3 CLI in immutable read-only mode (Chrome holds an exclusive
 *     lock when running; immutable=1 lets us read past it).
 *   - Fetch encrypted_value as hex.
 *   - Get the "Chrome Safe Storage" Keychain password via `security` CLI
 *     (this triggers a one-time user permission dialog).
 *   - Derive an AES-128 key: PBKDF2(password, salt='saltysalt', iter=1003, len=16, sha1).
 *   - The encrypted blob has 3-byte version prefix ('v10' or 'v11'); strip it.
 *   - AES-128-CBC decrypt with IV = 16 spaces, PKCS#7 padding.
 *
 * Returns null on any failure — caller falls through to next tier.
 *
 * NOTE: Chrome 130+ on macOS introduced 'v20' platform-bound encryption.
 * Those entries are not decryptable by this code and yield null.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const KEYCHAIN_PASSWORD_TIMEOUT_MS = 8_000;
const SQLITE_TIMEOUT_MS = 4_000;

let cachedDerivedKey: Buffer | null = null;

async function getMacChromeKey(): Promise<Buffer | null> {
  if (cachedDerivedKey) return cachedDerivedKey;
  try {
    const { stdout } = await execFileP(
      'security',
      ['find-generic-password', '-wga', 'Chrome', '-s', 'Chrome Safe Storage'],
      { timeout: KEYCHAIN_PASSWORD_TIMEOUT_MS },
    );
    const password = stdout.trim();
    if (!password) return null;
    cachedDerivedKey = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    return cachedDerivedKey;
  } catch {
    return null;
  }
}

function getDefaultProfileCookiesPath(): string {
  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'Default',
    'Cookies',
  );
}

async function readEncryptedCookieHex(
  cookiesPath: string,
  hostFragment: string,
  cookieName: string,
): Promise<string | null> {
  // Parameterised query via .param set isn't available in older sqlite3 CLI;
  // use single-quote escaping. Inputs are config-controlled, not user-typed.
  const safeHost = hostFragment.replace(/'/g, "''");
  const safeName = cookieName.replace(/'/g, "''");
  try {
    const { stdout } = await execFileP(
      'sqlite3',
      [
        `file:${cookiesPath}?mode=ro&immutable=1`,
        `SELECT hex(encrypted_value) FROM cookies WHERE host_key LIKE '%${safeHost}%' AND name='${safeName}' ORDER BY expires_utc DESC LIMIT 1;`,
      ],
      { timeout: SQLITE_TIMEOUT_MS },
    );
    const hex = stdout.trim();
    return hex || null;
  } catch {
    return null;
  }
}

function decryptV10(ciphertext: Buffer, key: Buffer): string | null {
  try {
    const iv = Buffer.alloc(16, 0x20); // 16 spaces
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Chrome 130+ on macOS prepends a 32-byte SHA-256(host_key) tamper check
    // to the cookie value plaintext. Strip the prefix when the tail decodes
    // to printable ASCII; otherwise treat the whole buffer as the value.
    if (plaintext.length > 32) {
      const tail = plaintext.subarray(32).toString('utf8');
      if (/^[\x20-\x7e]+$/.test(tail)) return tail;
    }
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Read a cookie value from Chrome's Default profile.
 * @returns plaintext cookie value, or null on any failure.
 */
export async function readChromeCookie(
  hostFragment: string,
  cookieName: string,
): Promise<string | null> {
  if (process.platform !== 'darwin') return null;

  const cookiesPath = getDefaultProfileCookiesPath();
  if (!fs.existsSync(cookiesPath)) return null;

  const hex = await readEncryptedCookieHex(cookiesPath, hostFragment, cookieName);
  if (!hex) return null;

  const encrypted = Buffer.from(hex, 'hex');
  if (encrypted.length < 4) return null;

  const versionTag = encrypted.subarray(0, 3).toString('utf8');
  if (versionTag !== 'v10' && versionTag !== 'v11') {
    // v20 (Chrome 130+ platform-bound) not supported.
    return null;
  }

  const key = await getMacChromeKey();
  if (!key) return null;

  const plaintext = decryptV10(encrypted.subarray(3), key);
  if (!plaintext) return null;

  return plaintext;
}
