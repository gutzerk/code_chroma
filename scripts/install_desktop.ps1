# One-command installer for CodeChroma on Windows (x64): downloads the pre-built
# CodeChroma-<version>-Setup.exe from the latest GitHub Release and runs it.
# No local checkout, no dev toolchain, no build -- the release CI already assembled the .exe.
#
#   powershell -ExecutionPolicy Bypass -File scripts/install_desktop.ps1
#
# Windows x64 only (that's the only Windows artifact the release workflow builds).
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repo   = "UshakovDV/code-chroma"
$ExeDir = Join-Path $HOME "Downloads"
$MaxBytes = 1073741824   # 1 GiB; fail-fast cap so a rogue oversized asset can't fill the disk

function Say([string]$Msg)  { Write-Host ""; Write-Host "==> $Msg" }
function Fatal([string]$Msg) { Write-Host "`n[A] $Msg" -ForegroundColor Red; exit 1 }

# --- platform guard ---------------------------------------------------------
if ($env:OS -ne "Windows_NT") { Fatal "This installer installs the Windows app; run it on Windows." }
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") { Fatal "This build only supports x64." }

# --- resolve the latest release asset ----------------------------------------
# Query the GitHub API for the newest release, then pick the Setup.exe asset.
Say "Resolving the latest CodeChroma release"
try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "code-chroma-installer" }
} catch {
    Fatal "Couldn't reach the GitHub API. Check network or that a release exists yet."
}
$Exe = @($Release.assets | Where-Object { $_.name -like "*-Setup.exe" } | Select-Object -First 1)
if (-not $Exe) { Fatal "Latest release has no Windows (x64) Setup.exe asset yet." }

# Keep only safe file-name characters; a hostile asset name must never reach a path unchecked.
$RawName = $Exe.name
$ExeName = [regex]::Replace((Split-Path -Leaf $RawName), '[^A-Za-z0-9._-]', '_')
$Url = "https://github.com/$Repo/releases/latest/download/$ExeName"

# --- download ---------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $ExeDir | Out-Null
$Dest = Join-Path $ExeDir $ExeName
$ShaFile = "$Dest.sha256"

# Fetch the checksum first: we never download a file we don't have a digest for yet.
Say "Fetching SHA-256 checksum"
try {
    $Expected = (Invoke-WebRequest -Uri "$Url.sha256" -UseBasicParsing).Content.Trim().Split(" ")[0]
} catch {
    Fatal "No checksum published for this release; refusing to install unverified."
}

# Download (cached copy reused when present), capped so a rogue oversized asset can't fill the disk.
# Invoke-WebRequest throws on any non-2xx before writing, so an aborted/oversized body can't land.
[scriptblock]$DownloadFn = {
    $resp = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing
    $len = $resp.Headers["Content-Length"]
    # A missing/zero Content-Length (some servers omit it on HEAD) means "unknown" — download anyway.
    if ($len) { if ([long]$len -gt $MaxBytes) { return $false } }
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing | Out-Null
    return $true
}
if (-not (Test-Path $Dest)) {
    Say "Downloading $ExeName"
    if (-not (& $DownloadFn)) { Fatal "Download failed, or the asset exceeds 1 GiB." }
} else {
    Say "Already downloaded: $Dest"
}

# --- integrity check ---------------------------------------------------------
# Verify the Setup.exe against the release's SHA-256 sidecar before launching it. A mismatch can
# mean a stale cached copy or a tampered download; either way we redownload once, then fail hard.
Say "Verifying SHA-256 checksum"
$Actual = (Get-FileHash -Path $Dest -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) {
    Say "Checksum mismatch; redownloading"
    Remove-Item -Force $Dest -ErrorAction SilentlyContinue
    if (-not (& $DownloadFn)) { Fatal "Download failed, or the asset exceeds 1 GiB." }
    $Actual = (Get-FileHash -Path $Dest -Algorithm SHA256).Hash.ToLowerInvariant()
}
if ($Actual -ne $Expected) { Fatal "Checksum mismatch - the download is corrupted or tampered with." }
Remove-Item -Force $ShaFile -ErrorAction SilentlyContinue

# --- run the NSIS installer ------------------------------------------------
# NSIS is not silent by design here; the user picks install options in the wizard.
Say "Running the installer (follow the wizard)"
Start-Process -FilePath $Dest -Wait

Say "Done. CodeChroma should now be installed; launch it from the Start menu."
