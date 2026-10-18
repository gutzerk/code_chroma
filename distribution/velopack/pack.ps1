<#
.SYNOPSIS
  Packs a published CodeChroma.Shell.App folder with Velopack (vpk) for Windows x64 and renames the outputs.
.DESCRIPTION
  Produces, in OutDir (plus a .sha256 sidecar each):
    CodeChroma-<Version>-win-x64-Installer.exe   fresh install (Velopack Setup, per-user, no UAC)
    CodeChroma-<Version>-win-x64.zip             update payload: the in-app updater swaps its current/ folder in
  scripts/gen_distribution_manifest.py and tests/unit/test_distribution_consistency.py pin these names.
#>
param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$PublishDir,
    [Parameter(Mandatory)][string]$OutDir,
    [string]$MainExe = 'CodeChroma.Shell.App.exe',
    [string]$Vpk = 'vpk'
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$') { throw "Version '$Version' is not semver (no leading v)." }
if (-not (Test-Path -LiteralPath (Join-Path $PublishDir $MainExe))) { throw "$MainExe not found in $PublishDir." }

$work = Join-Path ([IO.Path]::GetTempPath()) "codechroma-vpk-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $work, $OutDir | Out-Null
try {
    & $Vpk pack --packId CodeChroma --packTitle CodeChroma --packVersion $Version --packDir $PublishDir `
        --mainExe $MainExe --outputDir $work --channel win-x64 --runtime win-x64 `
        --icon (Join-Path $PSScriptRoot '..\..\dotnet\CodeChroma.Shell.App\Assets\icon.ico')
    if ($LASTEXITCODE -ne 0) { throw "vpk pack failed with exit code $LASTEXITCODE." }

    $outputs = [ordered]@{
        'CodeChroma-win-x64-Setup.exe'    = "CodeChroma-$Version-win-x64-Installer.exe"
        'CodeChroma-win-x64-Portable.zip' = "CodeChroma-$Version-win-x64.zip"
    }
    foreach ($source in $outputs.Keys) {
        $path = Join-Path $work $source
        if (-not (Test-Path -LiteralPath $path)) {
            $found = (Get-ChildItem -LiteralPath $work | ForEach-Object Name) -join ', '
            throw "vpk did not produce $source (found: $found)."
        }
        $name = $outputs[$source]
        $target = Join-Path $OutDir $name
        Copy-Item -LiteralPath $path -Destination $target -Force
        $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        [IO.File]::WriteAllText("$target.sha256", "$hash  $name`n", (New-Object Text.UTF8Encoding($false)))
        Write-Host "packed $name"
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
