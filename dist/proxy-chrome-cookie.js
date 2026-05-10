/**
 * Cross-platform Chrome cookie reader (Tier 2 of cookie auto-refresh).
 *
 * macOS:
 *   - ~/Library/Application Support/Google/Chrome/Default/Cookies
 *   - sqlite3 CLI (URI mode, immutable=1) → encrypted_value
 *   - `security find-generic-password ... 'Chrome Safe Storage'` → password
 *   - PBKDF2(password, 'saltysalt', iter=1003, len=16, sha1) → AES-128 key
 *   - v10/v11: AES-128-CBC, IV = 16 spaces, optional 32-byte SHA-256 prefix.
 *
 * Windows (Chrome ≥ 80):
 *   - %LOCALAPPDATA%\Google\Chrome\User Data\Default\Network\Cookies
 *     (falls back to Default\Cookies on older layouts).
 *   - winsqlite3.dll via PowerShell P/Invoke → encrypted_value (base64).
 *   - %LOCALAPPDATA%\Google\Chrome\User Data\Local State → JSON
 *     `os_crypt.encrypted_key` (base64); strip 5-byte 'DPAPI' prefix.
 *   - PowerShell ProtectedData::Unprotect (CurrentUser) → 32-byte AES-256 key.
 *   - v10: AES-256-GCM, 12-byte nonce + ciphertext + 16-byte auth tag.
 *   - v20 (Chrome 127+ "app-bound"): not supported (requires elevation
 *     service). Returns null and lets the caller fall through to Tier 3.
 *
 * Returns null on any failure — caller falls through to next tier.
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
const PS_TIMEOUT_MS = 8_000;
let cachedMacKey = null;
let cachedWinKey = null;
// ─── macOS ──────────────────────────────────────────────────────────────────
async function getMacChromeKey() {
    if (cachedMacKey)
        return cachedMacKey;
    try {
        const { stdout } = await execFileP('security', ['find-generic-password', '-wga', 'Chrome', '-s', 'Chrome Safe Storage'], { timeout: KEYCHAIN_PASSWORD_TIMEOUT_MS });
        const password = stdout.trim();
        if (!password)
            return null;
        cachedMacKey = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
        return cachedMacKey;
    }
    catch {
        return null;
    }
}
function macCookiesPath() {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies');
}
async function readMacEncryptedHex(cookiesPath, hostFragment, cookieName) {
    const safeHost = hostFragment.replace(/'/g, "''");
    const safeName = cookieName.replace(/'/g, "''");
    try {
        const { stdout } = await execFileP('sqlite3', [
            `file:${cookiesPath}?mode=ro&immutable=1`,
            `SELECT hex(encrypted_value) FROM cookies WHERE host_key LIKE '%${safeHost}%' AND name='${safeName}' ORDER BY expires_utc DESC LIMIT 1;`,
        ], { timeout: SQLITE_TIMEOUT_MS });
        return stdout.trim() || null;
    }
    catch {
        return null;
    }
}
function decryptMacCbc(ciphertext, key) {
    try {
        const iv = Buffer.alloc(16, 0x20); // 16 spaces
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(true);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        // Chrome 130+ on macOS prepends a 32-byte SHA-256(host_key) tamper check;
        // strip when the tail decodes to printable ASCII.
        if (plaintext.length > 32) {
            const tail = plaintext.subarray(32).toString('utf8');
            if (/^[\x20-\x7e]+$/.test(tail))
                return tail;
        }
        return plaintext.toString('utf8');
    }
    catch {
        return null;
    }
}
async function readMacCookie(hostFragment, cookieName) {
    const cookiesPath = macCookiesPath();
    if (!fs.existsSync(cookiesPath))
        return null;
    const hex = await readMacEncryptedHex(cookiesPath, hostFragment, cookieName);
    if (!hex)
        return null;
    const encrypted = Buffer.from(hex, 'hex');
    if (encrypted.length < 4)
        return null;
    const ver = encrypted.subarray(0, 3).toString('utf8');
    if (ver !== 'v10' && ver !== 'v11')
        return null;
    const key = await getMacChromeKey();
    if (!key)
        return null;
    return decryptMacCbc(encrypted.subarray(3), key);
}
// ─── Windows ────────────────────────────────────────────────────────────────
function winChromeUserDataDir() {
    const local = process.env.LOCALAPPDATA;
    if (!local)
        return null;
    return path.join(local, 'Google', 'Chrome', 'User Data');
}
function winCookiesPath(userData) {
    const newer = path.join(userData, 'Default', 'Network', 'Cookies');
    if (fs.existsSync(newer))
        return newer;
    const older = path.join(userData, 'Default', 'Cookies');
    if (fs.existsSync(older))
        return older;
    return null;
}
async function runPowerShell(script, envExtra) {
    // -EncodedCommand expects base64 of UTF-16LE script bytes.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    try {
        const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
            timeout: PS_TIMEOUT_MS,
            env: { ...process.env, ...envExtra },
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
        });
        return stdout.trim() || null;
    }
    catch {
        return null;
    }
}
const WIN_DPAPI_PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$enc = [Convert]::FromBase64String($env:CH_INPUT)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($plain))
`.trim();
// SQLite expects UTF-8 null-terminated strings. Marshalling .NET strings via
// LPStr would use the system ANSI codepage and corrupt non-ASCII paths (e.g.
// C:\Users\José\...). Pass byte[] of explicitly UTF-8-encoded data instead.
// Also escape '%', '#', '?' manually before building the file:/// URI — these
// bypass [System.Uri]'s lossy/path-truncation behaviour.
//
// Output is a JSON line `{"hostKey":"<utf8>","encrypted":"<base64>"}` so the
// caller can verify the SHA-256(host_key) cookie-binding prefix Chromium
// prepends to plaintext on recent versions (when present, strip; otherwise
// pass through — see decryptWinGcm).
const WIN_SQLITE_PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WS {
  [DllImport("winsqlite3.dll")] public static extern int sqlite3_open_v2(byte[] fn, out IntPtr db, int flags, IntPtr vfs);
  [DllImport("winsqlite3.dll")] public static extern int sqlite3_close_v2(IntPtr db);
  [DllImport("winsqlite3.dll")] public static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);
  [DllImport("winsqlite3.dll")] public static extern int sqlite3_step(IntPtr stmt);
  [DllImport("winsqlite3.dll")] public static extern int sqlite3_finalize(IntPtr stmt);
  [DllImport("winsqlite3.dll")] public static extern int sqlite3_column_bytes(IntPtr stmt, int col);
  [DllImport("winsqlite3.dll")] public static extern IntPtr sqlite3_column_blob(IntPtr stmt, int col);
  [DllImport("winsqlite3.dll")] public static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);
}
'@
$db = [IntPtr]::Zero
$safe = $env:CH_DB.Replace('%','%25').Replace('#','%23').Replace('?','%3F').Replace('\\','/')
$uri = "file:///$safe" + '?mode=ro&immutable=1'
$uriBytes = [System.Text.Encoding]::UTF8.GetBytes($uri + [char]0)
# SQLITE_OPEN_READONLY (0x01) | SQLITE_OPEN_URI (0x40) = 0x41
if ([WS]::sqlite3_open_v2($uriBytes, [ref]$db, 0x41, [IntPtr]::Zero) -ne 0) { exit 1 }
try {
  $sql = "SELECT host_key, encrypted_value FROM cookies WHERE host_key LIKE '%$($env:CH_HOST)%' AND name='$($env:CH_NAME)' ORDER BY expires_utc DESC LIMIT 1;"
  $sqlBytes = [System.Text.Encoding]::UTF8.GetBytes($sql + [char]0)
  $stmt = [IntPtr]::Zero
  if ([WS]::sqlite3_prepare_v2($db, $sqlBytes, -1, [ref]$stmt, [IntPtr]::Zero) -ne 0) { exit 2 }
  try {
    if ([WS]::sqlite3_step($stmt) -eq 100) {
      $hostLen = [WS]::sqlite3_column_bytes($stmt, 0)
      $hostKey = ''
      if ($hostLen -gt 0) {
        $hostPtr = [WS]::sqlite3_column_text($stmt, 0)
        $hostBuf = New-Object byte[] $hostLen
        [Runtime.InteropServices.Marshal]::Copy($hostPtr, $hostBuf, 0, $hostLen)
        $hostKey = [System.Text.Encoding]::UTF8.GetString($hostBuf)
      }
      $blobLen = [WS]::sqlite3_column_bytes($stmt, 1)
      if ($blobLen -gt 0) {
        $blobPtr = [WS]::sqlite3_column_blob($stmt, 1)
        $blobBuf = New-Object byte[] $blobLen
        [Runtime.InteropServices.Marshal]::Copy($blobPtr, $blobBuf, 0, $blobLen)
        $payload = @{ hostKey = $hostKey; encrypted = [Convert]::ToBase64String($blobBuf) }
        [Console]::Out.Write(($payload | ConvertTo-Json -Compress))
      }
    }
  } finally { [WS]::sqlite3_finalize($stmt) | Out-Null }
} finally { [WS]::sqlite3_close_v2($db) | Out-Null }
`.trim();
async function getWinChromeKey(userData) {
    if (cachedWinKey)
        return cachedWinKey;
    const localStatePath = path.join(userData, 'Local State');
    let encryptedKeyB64;
    try {
        const json = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
        const k = json?.os_crypt?.encrypted_key;
        if (typeof k !== 'string' || !k)
            return null;
        encryptedKeyB64 = k;
    }
    catch {
        return null;
    }
    const enc = Buffer.from(encryptedKeyB64, 'base64');
    if (enc.length <= 5 || enc.subarray(0, 5).toString('utf8') !== 'DPAPI')
        return null;
    const dpapiBlob = enc.subarray(5);
    const out = await runPowerShell(WIN_DPAPI_PS_SCRIPT, {
        CH_INPUT: dpapiBlob.toString('base64'),
    });
    if (!out)
        return null;
    try {
        const key = Buffer.from(out, 'base64');
        if (key.length !== 32)
            return null;
        cachedWinKey = key;
        return key;
    }
    catch {
        return null;
    }
}
async function readWinCookieRow(cookiesPath, hostFragment, cookieName) {
    const safeHost = hostFragment.replace(/'/g, "''");
    const safeName = cookieName.replace(/'/g, "''");
    const out = await runPowerShell(WIN_SQLITE_PS_SCRIPT, {
        CH_DB: cookiesPath,
        CH_HOST: safeHost,
        CH_NAME: safeName,
    });
    if (!out)
        return null;
    try {
        const parsed = JSON.parse(out);
        if (typeof parsed.hostKey !== 'string' || typeof parsed.encrypted !== 'string')
            return null;
        return { hostKey: parsed.hostKey, encrypted: parsed.encrypted };
    }
    catch {
        return null;
    }
}
function decryptWinGcm(blob, key, hostKey) {
    // v10 layout: 12-byte nonce + ciphertext + 16-byte GCM auth tag.
    if (blob.length < 12 + 16)
        return null;
    const nonce = blob.subarray(0, 12);
    const tag = blob.subarray(blob.length - 16);
    const ciphertext = blob.subarray(12, blob.length - 16);
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        // Recent Chromium (cookie DB v24+) prepends a 32-byte SHA-256(host_key)
        // tamper-binding to the cookie value plaintext on Windows. Strip it iff
        // the prefix matches; otherwise return the entire plaintext to remain
        // compatible with older Chrome builds that don't add the prefix.
        if (plaintext.length > 32 && hostKey) {
            const expected = crypto.createHash('sha256').update(hostKey, 'utf8').digest();
            const actual = plaintext.subarray(0, 32);
            if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
                return plaintext.subarray(32).toString('utf8');
            }
        }
        return plaintext.toString('utf8');
    }
    catch {
        return null;
    }
}
async function readWinCookie(hostFragment, cookieName) {
    const userData = winChromeUserDataDir();
    if (!userData)
        return null;
    const cookiesPath = winCookiesPath(userData);
    if (!cookiesPath)
        return null;
    const row = await readWinCookieRow(cookiesPath, hostFragment, cookieName);
    if (!row)
        return null;
    let encrypted;
    try {
        encrypted = Buffer.from(row.encrypted, 'base64');
    }
    catch {
        return null;
    }
    if (encrypted.length < 4)
        return null;
    const ver = encrypted.subarray(0, 3).toString('utf8');
    if (ver !== 'v10')
        return null; // v20 (app-bound) not supported
    const key = await getWinChromeKey(userData);
    if (!key)
        return null;
    return decryptWinGcm(encrypted.subarray(3), key, row.hostKey);
}
// ─── Public API ─────────────────────────────────────────────────────────────
export async function readChromeCookie(hostFragment, cookieName) {
    if (process.platform === 'darwin')
        return readMacCookie(hostFragment, cookieName);
    if (process.platform === 'win32')
        return readWinCookie(hostFragment, cookieName);
    return null;
}
//# sourceMappingURL=proxy-chrome-cookie.js.map