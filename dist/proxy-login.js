/**
 * Credential-based login (Tier 3 of cookie auto-refresh).
 *
 * POST email + password to reclaude.ai's auth endpoint, parse the Set-Cookie
 * response, return the rc_sid value.
 *
 * Password sources (never stored on disk by claude-hud):
 *   - macOS: `security find-generic-password` against the user's Keychain.
 *   - Windows: PowerShell P/Invoke of advapi32!CredReadW against the user's
 *     Credential Manager (Generic credential, target = "<service>:<account>"
 *     when account is set, else "<service>"). The CRED_TYPE_GENERIC blob is
 *     decoded as UTF-16LE inside PowerShell and re-emitted as UTF-8 base64,
 *     so Node only ever sees UTF-8.
 *
 * Failed logins use a 5-minute cooldown to avoid hammering the API on
 * persistent 401 (e.g. expired password).
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
async function getMacKeychainPassword(service, account) {
    try {
        const { stdout } = await execFileP('security', ['find-generic-password', '-wga', account, '-s', service], { timeout: KEYCHAIN_TIMEOUT_MS });
        const pwd = stdout.replace(/\n$/, '');
        return pwd || null;
    }
    catch {
        return null;
    }
}
// Microsoft's CRED_TYPE_GENERIC blob is documented as UTF-16LE (LPWSTR).
// Decode inside PowerShell and re-emit the password as base64 of UTF-8 bytes
// so the Node side never has to guess the encoding (the previous
// `blob.includes(0)` heuristic mis-classified non-Latin BMP UTF-16 passwords
// such as Chinese, where neither byte of a code unit is 0x00).
const WIN_CRED_PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CM {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buf);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CRED {
    public int Flags; public int Type; public IntPtr TargetName;
    public IntPtr Comment; public long LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
}
'@
$ptr = [IntPtr]::Zero
if ([CM]::CredReadW($env:CH_TARGET, 1, 0, [ref]$ptr)) {
  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [CM+CRED])
    if ($cred.CredentialBlobSize -gt 0) {
      $buf = New-Object byte[] $cred.CredentialBlobSize
      [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $buf, 0, $cred.CredentialBlobSize)
      $plain = [System.Text.Encoding]::Unicode.GetString($buf).TrimEnd([char]0)
      [Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($plain)))
    }
  } finally { [CM]::CredFree($ptr) }
}
`.trim();
async function getWinCredentialPassword(service, account) {
    const target = account ? `${service}:${account}` : service;
    const encoded = Buffer.from(WIN_CRED_PS_SCRIPT, 'utf16le').toString('base64');
    try {
        const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
            timeout: KEYCHAIN_TIMEOUT_MS,
            env: { ...process.env, CH_TARGET: target },
            windowsHide: true,
        });
        const out = stdout.trim();
        if (!out)
            return null;
        return Buffer.from(out, 'base64').toString('utf8') || null;
    }
    catch {
        return null;
    }
}
async function getKeychainPassword(service, account) {
    if (process.platform === 'darwin')
        return getMacKeychainPassword(service, account);
    if (process.platform === 'win32')
        return getWinCredentialPassword(service, account);
    return null;
}
function parseRcSidFromSetCookie(setCookieHeaders) {
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const header of headers) {
        if (!header)
            continue;
        // Set-Cookie may chain multiple cookies separated by comma in some servers;
        // split conservatively by ", " before "key=" boundary if the comma is inside
        // an Expires date this still works because we only look for rc_sid prefix.
        const candidates = header.split(/,(?=\s*[A-Za-z0-9_]+=)/);
        for (const candidate of candidates) {
            const m = /(?:^|\s)rc_sid=([^;]+)/.exec(candidate);
            if (m)
                return m[1].trim();
        }
    }
    return null;
}
function cooldownPath(cacheDir) {
    return path.join(cacheDir, COOLDOWN_FILE);
}
function isInCooldown(cacheDir, now) {
    try {
        const stat = fs.statSync(cooldownPath(cacheDir));
        return now - stat.mtimeMs < COOLDOWN_MS;
    }
    catch {
        return false;
    }
}
function setCooldown(cacheDir) {
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cooldownPath(cacheDir), String(Date.now()));
    }
    catch { /* ignore */ }
}
function clearCooldown(cacheDir) {
    try {
        fs.unlinkSync(cooldownPath(cacheDir));
    }
    catch { /* ignore */ }
}
/**
 * Attempt one login. Returns the new rc_sid value on success, or null.
 * Honours and updates a cooldown file to throttle repeated 401s.
 */
export async function loginAndExtractRcSid(input) {
    const now = input.now ?? Date.now();
    if (!input.email)
        return null;
    if (isInCooldown(input.cacheDir, now))
        return null;
    const password = await getKeychainPassword(input.passwordKeychainService, input.email);
    if (!password) {
        setCooldown(input.cacheDir);
        return null;
    }
    let res;
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
        }
        finally {
            clearTimeout(timer);
        }
    }
    catch {
        return null; // network errors don't trip cooldown — could be transient
    }
    if (!res.ok) {
        if (res.status === 401)
            setCooldown(input.cacheDir);
        return null;
    }
    // Node's fetch exposes Set-Cookie via raw headers iteration.
    const rawSetCookie = [];
    for (const [k, v] of res.headers.entries()) {
        if (k.toLowerCase() === 'set-cookie')
            rawSetCookie.push(v);
    }
    const rcSid = parseRcSidFromSetCookie(rawSetCookie);
    if (rcSid) {
        clearCooldown(input.cacheDir);
        return rcSid;
    }
    return null;
}
//# sourceMappingURL=proxy-login.js.map