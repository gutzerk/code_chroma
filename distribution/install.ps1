# One-command installer for the latest stable CodeChroma release on Windows (x64).
#
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1 | iex"
#
# With options, run the script as a script block:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1))) -Silent
# Options: -Silent (no wizard, per-user)  -Force (reinstall the same version)
#          -Uninstall (remove the app)  -Purge (with -Uninstall: also delete user data)
#          -Dotnet (install the C# app, a Velopack Setup, instead of the Electron app; it then removes an
#          installed Electron copy and keeps its user data. Its in-app updates are SHA-256 checked only.)
# Test hooks (weaken security, never set in production): CODECROMA_MANIFEST_URL, CODECROMA_PS_LIBRARY.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:Repo = 'gutzerk/code_chroma'
$script:SignerWorkflow = "$script:Repo/.github/workflows/release-please.yml"
$script:DefaultManifestUrl = "https://github.com/$script:Repo/releases/latest/download/latest.json"
$script:DefaultMaxBytes = 1GB

function Get-CodeChromaArch {
    if ($env:PROCESSOR_ARCHITEW6432) { return $env:PROCESSOR_ARCHITEW6432 }
    return $env:PROCESSOR_ARCHITECTURE
}

function Invoke-CodeChromaDownload {
    param([string]$Uri, [string]$OutFile, [long]$MaxBytes)
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
    if ((Get-Item -LiteralPath $OutFile).Length -gt $MaxBytes) {
        Remove-Item -LiteralPath $OutFile -Force
        throw "Download from $Uri exceeds $MaxBytes bytes."
    }
}

function Start-CodeChromaProcess {
    param([string]$FilePath, [string[]]$ArgumentList)
    $params = @{ FilePath = $FilePath; Wait = $true; PassThru = $true }
    if ($ArgumentList -and $ArgumentList.Count -gt 0) { $params.ArgumentList = $ArgumentList }
    return (Start-Process @params).ExitCode
}

function Get-CodeChromaGh {
    $command = Get-Command -Name 'gh' -CommandType Application -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Invoke-CodeChromaGh {
    param([string]$Gh, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    & $Gh @Arguments *> $null
    return $LASTEXITCODE
}

# Flavor: 'electron' (NSIS uninstaller), 'dotnet' (Velopack: the uninstall string runs Update.exe) or 'any'.
function Get-CodeChromaUninstallEntry {
    param([string]$Flavor = 'any')
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
            $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            if (-not $item -or $item.DisplayName -notmatch '^CodeChroma( \d\S*)?$') { continue }
            $isVelopack = ([string]$item.UninstallString) -match 'Update\.exe'
            if ($Flavor -eq 'any' -or ($Flavor -eq 'dotnet' -and $isVelopack) -or ($Flavor -eq 'electron' -and -not $isVelopack)) { return $item }
        }
    }
    return $null
}

function Get-CodeChromaInstalledVersion {
    param([string]$Flavor = 'any')
    $entry = Get-CodeChromaUninstallEntry -Flavor $Flavor
    if ($entry) { return [string]$entry.DisplayVersion }
    return $null
}

function Get-CodeChromaUninstallString {
    param([string]$Flavor = 'any')
    $entry = Get-CodeChromaUninstallEntry -Flavor $Flavor
    if ($entry) { return [string]$entry.UninstallString }
    return $null
}

# Runs one registered uninstaller silently: Velopack's is `Update.exe uninstall --silent`, NSIS's takes /S.
function Invoke-CodeChromaUninstallString {
    param([string]$UninstallString, [string]$Flavor)
    if ($UninstallString -match '^\s*"([^"]+)"\s*(.*)$') { $exe = $Matches[1]; $rest = $Matches[2] } else { $exe = $UninstallString; $rest = '' }
    $uninstallArgs = @($rest -split '\s+' | Where-Object { $_ })
    if ($Flavor -eq 'dotnet') { $uninstallArgs = @('uninstall', '--silent') } else { $uninstallArgs += '/S' }
    $code = Start-CodeChromaProcess -FilePath $exe -ArgumentList $uninstallArgs
    if ($code -ne 0) { throw "The CodeChroma uninstaller exited with code $code." }
}

function Get-Sha256Hex {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# After the C# app is installed, retire a per-user Electron copy; its user data (%APPDATA%\CodeChroma) is shared and kept.
function Remove-CodeChromaElectron {
    $uninstall = Get-CodeChromaUninstallString -Flavor 'electron'
    if (-not $uninstall) { return }
    Write-Host 'Removing the previous Electron build (your settings and recent projects are kept)...'
    try { Invoke-CodeChromaUninstallString -UninstallString $uninstall -Flavor 'electron' }
    catch { Write-Warning "Could not remove the Electron build automatically: $($_.Exception.Message) Remove it from Apps & features." }
}

function Install-CodeChroma {
    param(
        [string]$ManifestUrl = $(if ($env:CODECROMA_MANIFEST_URL) { $env:CODECROMA_MANIFEST_URL } else { $script:DefaultManifestUrl }),
        [switch]$Silent,
        [switch]$Force,
        [switch]$Dotnet,
        [long]$MaxBytes = $script:DefaultMaxBytes
    )
    $target = if ($Dotnet) { 'dotnet-windows-x64' } else { 'windows-x64' }
    $flavor = if ($Dotnet) { 'dotnet' } else { 'electron' }
    if ($env:OS -ne 'Windows_NT') { throw 'This installer supports Windows only.' }
    $arch = Get-CodeChromaArch
    if ($arch -ne 'AMD64') { throw "Unsupported architecture '$arch': CodeChroma for Windows is released for x64 only." }
    if ($env:CODECROMA_MANIFEST_URL) { Write-Warning "Using CODECROMA_MANIFEST_URL override (test hook): $ManifestUrl" }

    $tempDir = Join-Path ([IO.Path]::GetTempPath()) "codechroma-install-$([guid]::NewGuid().ToString('N'))"
    try {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
        $manifestPath = Join-Path $tempDir 'latest.json'
        try { Invoke-CodeChromaDownload -Uri $ManifestUrl -OutFile $manifestPath -MaxBytes 1MB }
        catch { throw "Could not download the release manifest: $($_.Exception.Message)" }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

        $url = $manifest.assets.$target
        $expectedHash = [string]$manifest.sha256.$target
        if (-not $url) { throw "The release manifest has no $target build." }
        if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$') { throw "The release manifest has no valid SHA-256 for $target." }
        $pinned = "https://github.com/$script:Repo/releases/download/"
        if (-not $env:CODECROMA_MANIFEST_URL -and -not $url.StartsWith($pinned)) {
            throw "Installer URL is not hosted by the $script:Repo releases: $url"
        }
        $version = [string]$manifest.version

        # The same version number exists in both flavors, so only an install of the same flavor counts.
        $installed = Get-CodeChromaInstalledVersion -Flavor $flavor
        if (-not $Force -and $installed -and $installed -eq $version) {
            Write-Host "CodeChroma $version is already installed (use -Force to reinstall)."
            return
        }

        $installerPath = Join-Path $tempDir $(if ($Dotnet) { 'CodeChroma-Installer.exe' } else { 'CodeChroma-Setup.exe' })
        Write-Host "Downloading CodeChroma $version..."
        try { Invoke-CodeChromaDownload -Uri $url -OutFile $installerPath -MaxBytes $MaxBytes }
        catch { throw "Could not download the CodeChroma installer: $($_.Exception.Message)" }

        $length = (Get-Item -LiteralPath $installerPath).Length
        if ($length -gt $MaxBytes) { throw "Download exceeds $MaxBytes bytes; refusing oversized installer." }
        $expectedSize = $manifest.size.$target
        if ($expectedSize -and [long]$expectedSize -ne $length) {
            throw "Download size $length does not match the manifest size $expectedSize."
        }
        if ((Get-Sha256Hex -Path $installerPath) -ne $expectedHash.ToLowerInvariant()) {
            throw 'CodeChroma installer checksum verification failed; the installer was not run.'
        }

        $gh = Get-CodeChromaGh
        if ($gh -and (Invoke-CodeChromaGh -Gh $gh -Arguments @('auth', 'status')) -eq 0) {
            $verify = @('attestation', 'verify', $installerPath, '--repo', $script:Repo, '--signer-workflow', $script:SignerWorkflow)
            if ((Invoke-CodeChromaGh -Gh $gh -Arguments $verify) -ne 0) {
                throw "attestation verification failed: this installer was not built by the $script:Repo release pipeline."
            }
            Write-Host 'Build provenance verified (gh attestation verify).'
        } else {
            Write-Warning 'gh is not installed or not logged in: only the SHA-256 checksum was verified, not build provenance (attestation). Install the GitHub CLI (https://cli.github.com) for full verification.'
        }

        if ($Dotnet) {
            Write-Warning 'The C# app''s in-app updates are verified by their SHA-256 checksum only (not signed or attested), unlike the Electron build''s Sigstore check.'
            $installerArgs = @()
            if ($Silent) { $installerArgs += '--silent' }
        } else {
            $installerArgs = @('/currentuser')
            if ($Silent) { $installerArgs += '/S' } else { Write-Host 'Starting the CodeChroma setup wizard...' }
        }
        $code = Start-CodeChromaProcess -FilePath $installerPath -ArgumentList $installerArgs
        if ($code -ne 0) { throw "The CodeChroma installer exited with code $code." }
        Write-Host 'CodeChroma installation completed.'
        if ($Dotnet) { Remove-CodeChromaElectron }
    } finally {
        if (Test-Path -LiteralPath $tempDir) {
            try { Remove-Item -LiteralPath $tempDir -Recurse -Force }
            catch { Write-Warning "Could not remove temporary installer files at $tempDir." }
        }
    }
}

function Uninstall-CodeChroma {
    param([switch]$Purge)
    $removed = $false
    foreach ($flavor in @('dotnet', 'electron')) {
        $uninstall = Get-CodeChromaUninstallString -Flavor $flavor
        if (-not $uninstall) { continue }
        Invoke-CodeChromaUninstallString -UninstallString $uninstall -Flavor $flavor
        $removed = $true
    }
    if ($removed) { Write-Host 'CodeChroma removed.' } else { Write-Host 'CodeChroma is not installed; nothing to remove.' }
    if ($Purge) {
        foreach ($dir in @((Join-Path $env:APPDATA 'CodeChroma'), (Join-Path $env:USERPROFILE '.codechroma'))) {
            if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
        }
        Write-Host 'Removed user data (settings, recents, diagram types).'
    } else {
        Write-Host 'User data kept (run with -Uninstall -Purge to delete it).'
    }
}

function Invoke-CodeChromaInstaller {
    param([string[]]$Arguments = @())
    $options = @{ Silent = $false; Force = $false; Uninstall = $false; Purge = $false; Dotnet = ($env:CODECROMA_APP -eq 'dotnet') }
    foreach ($arg in $Arguments) {
        $name = $arg.TrimStart('-')
        if ($arg.StartsWith('-') -and $options.ContainsKey($name)) { $options[$name] = $true }
        else { throw "usage: install.ps1 [-Dotnet] [-Silent] [-Force] [-Uninstall [-Purge]] (unknown option '$arg')" }
    }
    if ($options.Purge -and -not $options.Uninstall) { throw 'usage: -Purge only works together with -Uninstall' }
    if ($options.Uninstall) { Uninstall-CodeChroma -Purge:$options.Purge }
    else { Install-CodeChroma -Silent:$options.Silent -Force:$options.Force -Dotnet:$options.Dotnet }
}

if ($env:CODECROMA_PS_LIBRARY -ne '1') {
    try {
        Invoke-CodeChromaInstaller -Arguments $args
    } catch {
        if ($MyInvocation.MyCommand.Path) {
            [Console]::Error.WriteLine($_.Exception.Message)
            exit 1
        }
        throw
    }
}
