# One-command installer for the latest stable CodeChroma release on Windows.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1 | iex"
#
$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") {
    throw "This installer supports Windows only."
}

$repo = "gutzerk/code_chroma"
$baseUrl = "https://github.com/$repo/releases/latest/download"
$installerName = "CodeChroma-Setup.exe"
$checksumName = "$installerName.sha256"
$tempDir = Join-Path $env:TEMP "codechroma-install-$([guid]::NewGuid().ToString('N'))"
$installerPath = Join-Path $tempDir $installerName
$checksumPath = Join-Path $tempDir $checksumName

try {
    New-Item -ItemType Directory -Path $tempDir | Out-Null

    try {
        Invoke-WebRequest -Uri "$baseUrl/$installerName" -OutFile $installerPath -UseBasicParsing
    } catch {
        throw "Could not download the latest CodeChroma installer: $($_.Exception.Message)"
    }

    try {
        Invoke-WebRequest -Uri "$baseUrl/$checksumName" -OutFile $checksumPath -UseBasicParsing
    } catch {
        throw "Could not download the CodeChroma installer checksum: $($_.Exception.Message)"
    }

    $checksumText = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    $expectedHash = [regex]::Match($checksumText, '^([0-9a-fA-F]{64})(?:\s|$)').Groups[1].Value
    if (-not $expectedHash) {
        throw "The CodeChroma installer checksum file is invalid."
    }

    $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    if ($actualHash -ine $expectedHash) {
        throw "CodeChroma installer checksum verification failed; the installer was not run."
    }

    Write-Host "Checksum verified. Starting the CodeChroma setup wizard..."
    $process = Start-Process -FilePath $installerPath -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "The CodeChroma installer exited with code $($process.ExitCode)."
    }
    Write-Host "CodeChroma installation completed."
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        try {
            Remove-Item -LiteralPath $tempDir -Recurse -Force
        } catch {
            Write-Warning "Could not remove temporary installer files at $tempDir."
        }
    }
}
