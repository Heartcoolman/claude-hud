#Requires -Version 5.1
<#
Stores your reclaude.ai password in Windows Credential Manager so claude-hud
can auto-refresh the rc_sid cookie when it expires.

Usage:
  set-reclaude-password.ps1 you@example.com [-Service claude-hud-reclaude] [-Verify]

- Service defaults to "claude-hud-reclaude" (matches default config).
- The password is read interactively (no echo).
- The credential target is "<service>:<email>", for example
  "claude-hud-reclaude:you@example.com" — read by src/proxy-login.ts on 401.
- Existing entries are overwritten.
#>

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Email,

  [string] $Service = 'claude-hud-reclaude',

  [switch] $Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Stderr {
  param([Parameter(Mandatory = $true)][string] $Message)
  [Console]::Error.WriteLine($Message)
}

function Show-Usage {
  Write-Stderr "Usage: set-reclaude-password.ps1 <email> [-Service claude-hud-reclaude] [-Verify]"
  Write-Stderr "  Service defaults to: claude-hud-reclaude"
}

if ($Email -notmatch '^[^@]+@[^@]+\.[^@]+$') {
  Write-Stderr "Error: invalid email format."
  Show-Usage
  exit 2
}

try {
  if (Get-Module PSReadLine -ErrorAction SilentlyContinue) {
    Set-PSReadLineOption -HistorySaveStyle SaveNothing
  }
} catch {
  # Best effort only.
}

if (-not ('CredMgr' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CredMgr {
  public const int CRED_TYPE_GENERIC = 1;
  public const int CRED_PERSIST_LOCAL_MACHINE = 2;

  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWriteW(ref CRED credential, int flags);

  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);

  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr buf);

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CRED {
    public int Flags;
    public int Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
}
'@
}

$target = "$Service`:$Email"

function Test-CredentialBlobSize {
  param(
    [Parameter(Mandatory = $true)][string] $Target,
    [Parameter(Mandatory = $true)][int] $ExpectedSize
  )

  $ptr = [IntPtr]::Zero
  if (-not [CredMgr]::CredReadW($Target, [CredMgr]::CRED_TYPE_GENERIC, 0, [ref] $ptr)) {
    return $false
  }

  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type] [CredMgr+CRED])
    return $cred.CredentialBlobSize -eq $ExpectedSize
  } finally {
    if ($ptr -ne [IntPtr]::Zero) {
      [CredMgr]::CredFree($ptr)
    }
  }
}

if ($Verify) {
  $ptr = [IntPtr]::Zero
  if ([CredMgr]::CredReadW($target, [CredMgr]::CRED_TYPE_GENERIC, 0, [ref] $ptr)) {
    try {
      Write-Stderr "✓ Found Windows Credential Manager target='$target'"
      exit 0
    } finally {
      if ($ptr -ne [IntPtr]::Zero) {
        [CredMgr]::CredFree($ptr)
      }
    }
  }

  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Stderr "Error: Windows Credential Manager target not found: '$target' (Win32 error $err)."
  exit 5
}

$securePassword = Read-Host "Password for $Email (will not echo)" -AsSecureString
if ($securePassword.Length -eq 0) {
  Write-Stderr "Error: empty password, aborting."
  exit 3
}

$secureBuffer = [IntPtr]::Zero
$blobBuffer = [IntPtr]::Zero
$targetBuffer = [IntPtr]::Zero
$commentBuffer = [IntPtr]::Zero
$userBuffer = [IntPtr]::Zero
$blobLen = 0

try {
  $secureBuffer = [Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($securePassword)

  $charCount = $securePassword.Length
  $blobLen = $charCount * 2

  $passwordBytes = New-Object byte[] $blobLen
  [Runtime.InteropServices.Marshal]::Copy($secureBuffer, $passwordBytes, 0, $blobLen)

  $blobBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($blobLen)
  [Runtime.InteropServices.Marshal]::Copy($passwordBytes, 0, $blobBuffer, $blobLen)

  for ($i = 0; $i -lt $passwordBytes.Length; $i++) {
    $passwordBytes[$i] = 0
  }

  $targetBuffer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($target)
  $commentBuffer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni('claude-hud reclaude.ai auto-refresh credential')
  $userBuffer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($Email)

  $cred = New-Object CredMgr+CRED
  $cred.Flags = 0
  $cred.Type = [CredMgr]::CRED_TYPE_GENERIC
  $cred.TargetName = $targetBuffer
  $cred.Comment = $commentBuffer
  $cred.LastWritten = 0
  $cred.CredentialBlobSize = $blobLen
  $cred.CredentialBlob = $blobBuffer
  $cred.Persist = [CredMgr]::CRED_PERSIST_LOCAL_MACHINE
  $cred.AttributeCount = 0
  $cred.Attributes = [IntPtr]::Zero
  $cred.TargetAlias = [IntPtr]::Zero
  $cred.UserName = $userBuffer

  if (-not [CredMgr]::CredWriteW([ref] $cred, 0)) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Stderr "Error: CredWriteW failed for target='$target' (Win32 error $err)."
    exit 4
  }
} finally {
  if ($secureBuffer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($secureBuffer)
  }

  if ($blobBuffer -ne [IntPtr]::Zero) {
    for ($i = 0; $i -lt $blobLen; $i++) {
      [Runtime.InteropServices.Marshal]::WriteByte($blobBuffer, $i, 0)
    }
    [Runtime.InteropServices.Marshal]::FreeHGlobal($blobBuffer)
  }

  if ($targetBuffer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($targetBuffer)
  }

  if ($commentBuffer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($commentBuffer)
  }

  if ($userBuffer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($userBuffer)
  }
}

if (-not (Test-CredentialBlobSize -Target $target -ExpectedSize $blobLen)) {
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Stderr "Error: verification failed for target='$target' (Win32 error $err)."
  exit 5
}

Write-Stderr "✓ Stored in Windows Credential Manager as target='$target'"
Write-Stderr "Verify with: cmdkey /list:$target"
exit 0
