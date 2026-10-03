# One-command installer for CodeChroma on Windows (x64), style of herdr/distribution/install.ps1
# but slimmed for a GUI Setup.exe (herdr's 700-line atomic-junction + ConPTY logic doesn't apply --
# the NSIS installer owns the actual install). Reads distribution/latest.json, downloads the
# platform Setup.exe from the matching GitHub Release, verifies its SHA-256, then runs the installer.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/gutzerk/code-chroma/main/distribution/install.ps1 | iex"
#
[CmdletBinding()]
param(
    [string]$ManifestUrl = $env:CODECROMA_MANIFEST_URL,
    [string]$DownloadDir  = $env:CODECROMA_DOWNLOAD_DIR
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Say  ([string]$Msg)  { Write-Host "==> $Msg" }
function Fatal([string]$Msg)  { Write-Host "`n[A] $Msg" -ForegroundColor Red; exit 1 }

# --- platform guard ---------------------------------------------------------
if ($env:OS -ne "Windows_NT") { Fatal "This installer installs the Windows app; run it on Windows." }
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") { Fatal "This build only supports x64." }

$Repo = "gutzerk/code-chroma"
if ([string]::IsNullOrWhiteSpace($ManifestUrl)) {
    $ManifestUrl = "https://github.com/$Repo/releases/latest/download/latest.json"
}
if ([string]::IsNullOrWhiteSpace($DownloadDir)) {
    $DownloadDir = Join-Path $HOME "Downloads"
}
$MaxBytes = 1073741824   # 1 GiB; fail-fast cap so a rogue oversized asset can't fill the disk
$Target = "windows-x64"

# --- fetch manifest and pull out this target's URL + checksum -----------------
Say "Fetching latest release manifest"
try {
    $Manifest = (Invoke-WebRequest -Uri $ManifestUrl -UseBasicParsing).Content | ConvertFrom-Json
} catch {
    Fatal "Can't reach $ManifestUrl. Check network, or that a release exists yet."
}
$Url = [string]$Manifest.assets.$Target
$Sha = [string]$Manifest.sha256.$Target
$Version = [string]$Manifest.version
if ([string]::IsNullOrWhiteSpace($Url))  { Fatal "Release manifest has no binary for $Target." }
if ($Sha -notmatch '^[0-9a-fA-F]{64}$')  { Fatal "Release manifest has no valid SHA-256 for $Target." }

$ExeName = [regex]::Replace((Split-Path -Leaf $Url), '[^A-Za-z0-9._-]', '_')
if ([string]::IsNullOrWhiteSpace($ExeName)) { Fatal "Could not derive a file name from the manifest URL." }

# --- download ----------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
$Dest = Join-Path $DownloadDir $ExeName

$DownloadFn = {
    $resp = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing
    $len = $resp.Headers["Content-Length"]
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

# --- integrity check -----------------------------------------------------------
Say "Verifying SHA-256 checksum"
$Actual = (Get-FileHash -Path $Dest -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Actual -ne ($Sha.ToLowerInvariant())) {
    Say "Checksum mismatch; redownloading"
    Remove-Item -Force $Dest -ErrorAction SilentlyContinue
    if (-not (& $DownloadFn)) { Fatal "Download failed, or the asset exceeds 1 GiB." }
    $Actual = (Get-FileHash -Path $Dest -Algorithm SHA256).Hash.ToLowerInvariant()
}
if ($Actual -ne $Sha.ToLowerInvariant()) { Fatal "Checksum mismatch - the download is corrupted or tampered with." }

# --- run the NSIS installer -----------------------------------------------------
# NSIS is not silent by design here; the user picks install options in the wizard.
Say "Running the installer (follow the wizard)"
Start-Process -FilePath $Dest -Wait

if ([string]::IsNullOrWhiteSpace($Version)) { $Version = "(unknown)" }
Say "Done. CodeChroma $Version installed; launch it from the Start menu."
