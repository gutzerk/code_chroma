#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $env:CODECROMA_PS_LIBRARY = '1'
    . (Join-Path $PSScriptRoot '..\..\distribution\install.ps1')

    function New-Fixture {
        param([string]$Root, [string]$Version = '1.2.3', [byte[]]$Payload = ([Text.Encoding]::UTF8.GetBytes('setup bytes')), [hashtable]$ManifestOverrides = @{})
        $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($Payload)).Replace('-', '').ToLowerInvariant()
        $tag = "v$Version"
        $manifest = [ordered]@{
            version = $Version
            channel = 'stable'
            assets  = @{ 'windows-x64' = "https://github.com/gutzerk/code_chroma/releases/download/$tag/CodeChroma-Setup.exe" }
            sha256  = @{ 'windows-x64' = $sha }
            size    = @{ 'windows-x64' = $Payload.Length }
        }
        foreach ($key in $ManifestOverrides.Keys) { $manifest[$key] = $ManifestOverrides[$key] }
        $manifestPath = Join-Path $Root 'latest.json'
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8
        $installerPath = Join-Path $Root 'CodeChroma-Setup.exe'
        [IO.File]::WriteAllBytes($installerPath, $Payload)
        return @{ Manifest = $manifestPath; Installer = $installerPath }
    }

    function Use-Fixture {
        param($Fixture)
        $script:fixture = $Fixture
        $script:started = New-Object System.Collections.ArrayList
        Mock Invoke-CodeChromaDownload {
            param($Uri, $OutFile, $MaxBytes)
            $script:requested += @($Uri)
            if ($Uri -like '*latest.json') { Copy-Item -LiteralPath $script:fixture.Manifest -Destination $OutFile }
            else { Copy-Item -LiteralPath $script:fixture.Installer -Destination $OutFile }
        }
        Mock Start-CodeChromaProcess {
            param($FilePath, $ArgumentList)
            [void]$script:started.Add(@{ FilePath = $FilePath; Args = $ArgumentList })
            return 0
        }
        Mock Get-CodeChromaInstalledVersion { return $null }
        Mock Get-CodeChromaArch { return 'AMD64' }
        Mock Get-CodeChromaGh { return $null }
        Mock Write-Host {}
        Mock Write-Warning {}
        $script:requested = @()
    }
}

Describe 'Install-CodeChroma' {
    BeforeEach {
        Use-Fixture (New-Fixture -Root $TestDrive)
    }

    It 'runs the installer interactively by default after verifying the checksum' {
        Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json'

        $script:started.Count | Should -Be 1
        $script:started[0].Args | Should -Not -Contain '/S'
    }

    It 'runs a silent per-user install with -Silent' {
        Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' -Silent

        $script:started[0].Args | Should -Contain '/S'
        $script:started[0].Args | Should -Contain '/currentuser'
    }

    It 'downloads the version-pinned installer, never the mutable latest alias' {
        Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json'

        ($script:requested -join ' ') | Should -Match '/releases/download/v1\.2\.3/CodeChroma-Setup\.exe'
        ($script:requested -join ' ') | Should -Not -Match '/releases/latest/'
    }

    It 'refuses a checksum mismatch and never starts the installer' {
        Use-Fixture (New-Fixture -Root $TestDrive -ManifestOverrides @{ sha256 = @{ 'windows-x64' = ('0' * 64) } })

        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' } | Should -Throw '*checksum*'

        $script:started.Count | Should -Be 0
    }

    It 'refuses a download whose size disagrees with the manifest' {
        Use-Fixture (New-Fixture -Root $TestDrive -ManifestOverrides @{ size = @{ 'windows-x64' = 3 } })

        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' } | Should -Throw '*size*'

        $script:started.Count | Should -Be 0
    }

    It 'refuses a download above the size cap' {
        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' -MaxBytes 4 } | Should -Throw '*exceeds*'

        $script:started.Count | Should -Be 0
    }

    It 'refuses an installer URL outside the canonical GitHub repo' {
        Use-Fixture (New-Fixture -Root $TestDrive -ManifestOverrides @{ assets = @{ 'windows-x64' = 'https://evil.example/CodeChroma-Setup.exe' } })

        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' } | Should -Throw '*not hosted*'

        $script:started.Count | Should -Be 0
    }

    It 'fails when the manifest has no Windows build' {
        Use-Fixture (New-Fixture -Root $TestDrive -ManifestOverrides @{ assets = @{ 'linux-x64' = 'https://github.com/gutzerk/code_chroma/x' } })

        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' } | Should -Throw '*windows-x64*'
    }

    It 'rejects an unsupported architecture' {
        Mock Get-CodeChromaArch { return 'ARM64' }

        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' } | Should -Throw '*architecture*'

        $script:started.Count | Should -Be 0
    }

    It 'skips the install when the same version is already installed' {
        Mock Get-CodeChromaInstalledVersion { return '1.2.3' }

        Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json'

        $script:started.Count | Should -Be 0
    }

    It 'reinstalls the same version with -Force' {
        Mock Get-CodeChromaInstalledVersion { return '1.2.3' }

        Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' -Force

        $script:started.Count | Should -Be 1
    }

    It 'fails when the installer exits with a non-zero code' {
        Mock Start-CodeChromaProcess { return 5 }

        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' } | Should -Throw '*exited with code 5*'
    }

    It 'verifies the attestation when gh is available' {
        Mock Get-CodeChromaGh { return 'gh.exe' }
        Mock Invoke-CodeChromaGh { return 0 }

        Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json'

        Should -Invoke Invoke-CodeChromaGh -ParameterFilter { ($Arguments -join ' ') -match 'attestation verify' -and ($Arguments -join ' ') -match 'gutzerk/code_chroma' }
    }

    It 'blocks the install when attestation verification fails' {
        Mock Get-CodeChromaGh { return 'gh.exe' }
        Mock Invoke-CodeChromaGh { return 0 } -ParameterFilter { $Arguments[0] -eq 'auth' }
        Mock Invoke-CodeChromaGh { return 1 } -ParameterFilter { $Arguments[0] -eq 'attestation' }

        { Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json' } | Should -Throw '*attestation*'

        $script:started.Count | Should -Be 0
    }

    It 'warns that only SHA-256 was checked when gh is missing' {
        Install-CodeChroma -ManifestUrl 'https://example.invalid/latest.json'

        Should -Invoke Write-Warning -ParameterFilter { $Message -match 'SHA-256' }
    }
}

Describe 'Uninstall-CodeChroma' {
    BeforeEach {
        Use-Fixture (New-Fixture -Root $TestDrive)
        $env:APPDATA = Join-Path $TestDrive 'AppData'
        $env:USERPROFILE = Join-Path $TestDrive 'Profile'
        New-Item -ItemType Directory -Force -Path (Join-Path $env:APPDATA 'CodeChroma') | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE '.codechroma') | Out-Null
        Mock Get-CodeChromaUninstallString { return '"C:\Apps\CodeChroma\Uninstall CodeChroma.exe" /currentuser' }
    }

    It 'runs the registered uninstaller silently and keeps user data' {
        Uninstall-CodeChroma

        $script:started.Count | Should -Be 1
        $script:started[0].Args | Should -Contain '/S'
        (Join-Path $env:APPDATA 'CodeChroma') | Should -Exist
        (Join-Path $env:USERPROFILE '.codechroma') | Should -Exist
    }

    It 'removes user data with -Purge' {
        Uninstall-CodeChroma -Purge

        (Join-Path $env:APPDATA 'CodeChroma') | Should -Not -Exist
        (Join-Path $env:USERPROFILE '.codechroma') | Should -Not -Exist
    }

    It 'is a clean no-op when nothing is installed' {
        Mock Get-CodeChromaUninstallString { return $null }

        { Uninstall-CodeChroma } | Should -Not -Throw

        $script:started.Count | Should -Be 0
    }
}

Describe 'Invoke-CodeChromaInstaller argument parsing' {
    BeforeEach {
        Use-Fixture (New-Fixture -Root $TestDrive)
        Mock Install-CodeChroma {}
        Mock Uninstall-CodeChroma {}
    }

    It 'routes -Uninstall -Purge to the uninstaller' {
        Invoke-CodeChromaInstaller @('-Uninstall', '-Purge')

        Should -Invoke Uninstall-CodeChroma -ParameterFilter { $Purge }
        Should -Invoke Install-CodeChroma -Times 0
    }

    It 'routes -Silent -Force to the installer' {
        Invoke-CodeChromaInstaller @('-Silent', '-Force')

        Should -Invoke Install-CodeChroma -ParameterFilter { $Silent -and $Force }
    }

    It 'rejects unknown options' {
        { Invoke-CodeChromaInstaller @('-Bogus') } | Should -Throw '*usage*'
    }
}
