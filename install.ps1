$ErrorActionPreference = "Stop"

$manifestUrl = "https://github.com/gutzerk/code_chroma/releases/latest/download/latest.json"
$tempDirectory = $null

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "This installer supports Windows only."
    }

    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) {
        $architecture = $env:PROCESSOR_ARCHITECTURE
    }
    if ($architecture -notmatch "^(AMD64|x86_64)$") {
        throw "Unsupported Windows architecture '$architecture'. Only x64 is currently available."
    }

    $manifest = Invoke-RestMethod -Uri $manifestUrl -UseBasicParsing
    $assetUrl = [string]$manifest.assets."windows-x64"
    $expectedSha256 = [string]$manifest.sha256."windows-x64"

    if (-not $assetUrl -or -not $expectedSha256) {
        throw "The latest release manifest does not include a Windows x64 installer and checksum."
    }
    if ($assetUrl -notmatch "^https://github\.com/gutzerk/code_chroma/releases/download/.+-Setup\.exe$") {
        throw "The release manifest contains an unexpected installer URL."
    }
    if ($expectedSha256 -notmatch "^[0-9a-fA-F]{64}$") {
        throw "The release manifest contains an invalid SHA-256 checksum."
    }

    $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("codechroma-install-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tempDirectory | Out-Null
    $installerPath = Join-Path $tempDirectory "CodeChroma-Setup.exe"

    Invoke-WebRequest -Uri $assetUrl -OutFile $installerPath -UseBasicParsing
    $actualSha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    if ($actualSha256 -ne $expectedSha256) {
        throw "SHA-256 verification failed. The installer was not run."
    }

    Write-Host "Verified installer SHA-256. Starting the CodeChroma setup wizard..."
    $process = Start-Process -FilePath $installerPath -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "The CodeChroma installer exited with code $($process.ExitCode)."
    }
    Write-Host "CodeChroma installation completed."
}
catch {
    Write-Error "CodeChroma installer: $($_.Exception.Message)"
    exit 1
}
finally {
    if ($tempDirectory -and (Test-Path -LiteralPath $tempDirectory)) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force
    }
}
