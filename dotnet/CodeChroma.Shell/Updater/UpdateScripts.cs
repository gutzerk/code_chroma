namespace CodeChroma.Shell;

/// <summary>The detached helpers that swap a staged update in after the app exits and roll back if the new version dies at startup.</summary>
public static class UpdateScripts
{
    public const string PosixName = "apply-update.sh";
    public const string WindowsName = "apply-update.ps1";

    /// <summary>
    /// Args: PID MODE TARGET STAGED PREVIOUS RESULT VERSION HEALTH_SECONDS KEEP_PREVIOUS. MODE is mac (open + pgrep) or exec
    /// (run TARGET directly). Test hooks CODECROMA_OPEN_BIN and CODECROMA_PGREP_BIN replace open and pgrep.
    /// </summary>
    public const string Posix = """
        #!/bin/sh
        # Applies a staged CodeChroma update after the running app exits; restores the previous version if the new one dies at startup.
        pid="$1"; mode="$2"; target="$3"; staged="$4"; previous="$5"; result="$6"; version="$7"; health="$8"; keep="$9"
        open_bin="${CODECROMA_OPEN_BIN:-open}"
        pgrep_bin="${CODECROMA_PGREP_BIN:-pgrep}"
        launched=""
        unset APPIMAGE APPDIR ARGV0 OWD
        trap 'rm -f "$0"' EXIT

        report() {
            mkdir -p "$(dirname "$result")" 2>/dev/null
            printf '{"result":"%s","version":"%s","detail":"%s"}\n' "$1" "$version" "$2" > "$result.tmp" && mv -f "$result.tmp" "$result"
        }
        launch() {
            case "$mode" in
                mac) "$open_bin" -n "$1" >/dev/null 2>&1 ;;
                *) "$1" >/dev/null 2>&1 & launched=$! ;;
            esac
        }
        alive() {
            case "$mode" in
                mac) "$pgrep_bin" -f "$1/Contents/MacOS/" >/dev/null 2>&1 ;;
                *) kill -0 "$launched" 2>/dev/null ;;
            esac
        }

        waited=0
        while kill -0 "$pid" 2>/dev/null; do
            waited=$((waited + 1))
            if [ "$waited" -gt 120 ]; then
                report failed "CodeChroma did not exit in time; the update was not applied"
                rm -rf "$staged"
                exit 1
            fi
            sleep 1
        done

        rm -rf "$previous"
        if [ -e "$target" ] && ! mv "$target" "$previous"; then
            report failed "could not move the current version aside; it was left untouched"
            rm -rf "$staged"
            launch "$target"
            exit 1
        fi
        if ! mv "$staged" "$target"; then
            [ ! -e "$previous" ] || mv "$previous" "$target"
            report failed "could not put the new version in place; the previous version was restored"
            launch "$target"
            exit 1
        fi

        launch "$target"
        elapsed=0
        healthy=1
        while [ "$elapsed" -lt "$health" ]; do
            sleep 1
            elapsed=$((elapsed + 1))
            if ! alive "$target"; then
                if [ "$mode" = mac ]; then
                    healthy=0
                else
                    wait "$launched"
                    [ "$?" -eq 0 ] || healthy=0
                fi
                break
            fi
        done

        if [ "$healthy" -eq 0 ]; then
            rm -rf "$target"
            if [ -e "$previous" ] && mv "$previous" "$target"; then
                report rolled-back "the new version exited during startup; the previous version was restored"
                launch "$target"
            else
                report failed "the new version failed and the previous version could not be restored"
            fi
            exit 1
        fi
        [ "$keep" = 1 ] || rm -rf "$previous"
        report updated "ok"

        """;

    public const string Windows = """
        param(
            [Parameter(Mandatory)][int]$ProcessId,
            [Parameter(Mandatory)][string]$Target,
            [Parameter(Mandatory)][string]$Staged,
            [Parameter(Mandatory)][string]$Previous,
            [Parameter(Mandatory)][string]$Exe,
            [Parameter(Mandatory)][string]$ResultFile,
            [Parameter(Mandatory)][string]$Version,
            [int]$HealthSeconds = 8,
            [int]$WaitSeconds = 120,
            [switch]$KeepPrevious
        )
        # Applies a staged CodeChroma update after the running app exits; restores the previous directory if the new exe dies at startup.
        $ErrorActionPreference = 'Stop'

        function Write-Result([string]$Result, [string]$Detail) {
            $dir = Split-Path -Parent $ResultFile
            if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
            $json = [ordered]@{ result = $Result; version = $Version; detail = $Detail } | ConvertTo-Json -Compress
            [IO.File]::WriteAllText("$ResultFile.tmp", $json, (New-Object Text.UTF8Encoding($false)))
            Move-Item -LiteralPath "$ResultFile.tmp" -Destination $ResultFile -Force
        }
        function Move-WithRetry([string]$From, [string]$To) {
            for ($i = 0; $i -lt 20; $i++) {
                try { Move-Item -LiteralPath $From -Destination $To -ErrorAction Stop; return $true }
                catch { Start-Sleep -Milliseconds 500 }
            }
            return $false
        }
        function Start-App {
            $p = Start-Process -FilePath (Join-Path $Target $Exe) -WorkingDirectory $Target -PassThru
            [void]$p.Handle
            return $p
        }

        $deadline = (Get-Date).AddSeconds($WaitSeconds)
        while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
            if ((Get-Date) -gt $deadline) {
                Write-Result 'failed' 'CodeChroma did not exit in time; the update was not applied'
                Remove-Item -LiteralPath $Staged -Recurse -Force -ErrorAction SilentlyContinue
                exit 1
            }
            Start-Sleep -Milliseconds 500
        }

        # The helper inherits the app's cwd (inside $Target), and a directory that is any process's cwd cannot be renamed.
        Set-Location -LiteralPath ([IO.Path]::GetTempPath())
        # The bridge and agent children can outlive the shell for a moment and keep files in $Target open.
        $root = $Target.TrimEnd('\') + '\'
        foreach ($i in 1..20) {
            $left = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID -and $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })
            if ($left.Count -eq 0) { break }
            if ($i -ge 10) { $left | Stop-Process -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Milliseconds 500
        }

        if (Test-Path -LiteralPath $Previous) { Remove-Item -LiteralPath $Previous -Recurse -Force }
        if (Test-Path -LiteralPath $Target) {
            if (-not (Move-WithRetry $Target $Previous)) {
                Write-Result 'failed' 'could not move the current version aside; it was left untouched'
                Remove-Item -LiteralPath $Staged -Recurse -Force -ErrorAction SilentlyContinue
                [void](Start-App)
                exit 1
            }
        }
        if (-not (Move-WithRetry $Staged $Target)) {
            if (Test-Path -LiteralPath $Previous) { [void](Move-WithRetry $Previous $Target) }
            Write-Result 'failed' 'could not put the new version in place; the previous version was restored'
            [void](Start-App)
            exit 1
        }

        $proc = Start-App
        $exited = $proc.WaitForExit($HealthSeconds * 1000)
        if ($exited -and $proc.ExitCode -ne 0) {
            if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
            if ((Test-Path -LiteralPath $Previous) -and (Move-WithRetry $Previous $Target)) {
                Write-Result 'rolled-back' 'the new version exited during startup; the previous version was restored'
                [void](Start-App)
            } else {
                Write-Result 'failed' 'the new version failed and the previous version could not be restored'
            }
            exit 1
        }
        if (-not $KeepPrevious) { Remove-Item -LiteralPath $Previous -Recurse -Force -ErrorAction SilentlyContinue }
        Write-Result 'updated' 'ok'

        """;
}
