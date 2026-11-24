using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Messages;

/// <summary>Where the integration tokens live; the only thing the messages feature writes to disk.</summary>
public interface ITokenVault
{
    /// <summary>"dpapi", "keychain", "libsecret", "file" or "memory".</summary>
    string Backend { get; }

    /// <summary>Shown in Settings when tokens are not in an OS keychain, else null.</summary>
    string? Warning { get; }

    string? Get(string key);

    void Set(string key, string value);

    void Delete(string key);
}

/// <summary>The vault keys the messages feature uses.</summary>
public static class VaultKeys
{
    public const string SlackUserToken = "slack.user_token";
    public const string SlackAppToken = "slack.app_token";
    public const string OutlookRefreshToken = "outlook.refresh_token";
    public const string OutlookClientId = "outlook.client_id";
    public const string OutlookTenant = "outlook.tenant";

    public static readonly string[] Slack = [SlackUserToken, SlackAppToken];
    public static readonly string[] Outlook = [OutlookRefreshToken, OutlookClientId, OutlookTenant];
}

/// <summary>Picks the OS keychain for this platform, falling back to a 0600 file when there is none.</summary>
public static class TokenVault
{
    public const string Service = "codechroma";

    public static ITokenVault ForPlatform(string fallbackFile)
    {
        if (OperatingSystem.IsWindows()) return new DpapiVault(fallbackFile);
        if (OperatingSystem.IsMacOS()) return new MacKeychainVault();
        return SecretToolVault.IsUsable() ? new SecretToolVault() : new FileVault(fallbackFile,
            "No libsecret keyring was found (secret-tool is missing or has no session), so tokens are kept in a file only you can read: " + fallbackFile);
    }
}

/// <summary>An in-memory vault (tests, and a machine where nothing may be written).</summary>
public sealed class MemoryVault : ITokenVault
{
    private readonly Dictionary<string, string> _values = [];

    public string Backend => "memory";
    public string? Warning => null;

    public string? Get(string key) { lock (_values) return _values.GetValueOrDefault(key); }

    public void Set(string key, string value) { lock (_values) _values[key] = value; }

    public void Delete(string key) { lock (_values) _values.Remove(key); }
}

/// <summary>A JSON file of key to text, created 0600 on Unix; the base for the DPAPI vault too.</summary>
public class FileVault(string path, string? warning) : ITokenVault
{
    private readonly object _gate = new();

    public virtual string Backend => "file";
    public string? Warning => warning;

    public string? Get(string key)
    {
        lock (_gate) return Json.Str(JsonFile.LoadObject(path)[key]) is { } stored ? Unprotect(stored) : null;
    }

    public void Set(string key, string value)
    {
        lock (_gate)
        {
            var all = JsonFile.LoadObject(path);
            all[key] = Protect(value);
            Write(all);
        }
    }

    public void Delete(string key)
    {
        lock (_gate)
        {
            var all = JsonFile.LoadObject(path);
            if (!all.Remove(key)) return;
            if (all.Count == 0) File.Delete(path);
            else Write(all);
        }
    }

    protected virtual string Protect(string value) => value;

    protected virtual string? Unprotect(string stored) => stored;

    private void Write(JsonObject all)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = $"{path}.{Guid.NewGuid():N}.tmp";
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        using (var stream = new FileStream(temp, options))
        using (var writer = new StreamWriter(stream)) writer.Write(all.ToJsonString());
        File.Move(temp, path, overwrite: true);
    }
}

/// <summary>Windows: each value encrypted with DPAPI for the current user, stored in the vault file.</summary>
public sealed class DpapiVault(string path) : FileVault(path, null)
{
    public override string Backend => "dpapi";

    protected override string Protect(string value)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("DPAPI is Windows-only");
        return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser));
    }

    protected override string? Unprotect(string stored)
    {
        if (!OperatingSystem.IsWindows()) return null;
        try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored), null, DataProtectionScope.CurrentUser)); }
        catch (Exception error) when (error is CryptographicException or FormatException) { return null; }
    }
}

/// <summary>macOS: one generic password per key in the login keychain, through the security CLI.</summary>
public sealed class MacKeychainVault : ITokenVault
{
    public string Backend => "keychain";
    public string? Warning => null;

    public string? Get(string key)
    {
        var result = VaultProcess.Run("security", ["find-generic-password", "-s", TokenVault.Service, "-a", key, "-w"]);
        return result.Exit == 0 ? result.Stdout.TrimEnd('\n') : null;
    }

    public void Set(string key, string value)
    {
        var result = VaultProcess.Run("security", ["add-generic-password", "-U", "-s", TokenVault.Service, "-a", key, "-w", value]);
        if (result.Exit != 0) throw new IOException($"keychain write failed: {result.Stderr.Trim()}");
    }

    public void Delete(string key) => VaultProcess.Run("security", ["delete-generic-password", "-s", TokenVault.Service, "-a", key]);
}

/// <summary>Linux: libsecret through secret-tool; the secret goes over stdin, never argv.</summary>
public sealed class SecretToolVault : ITokenVault
{
    public string Backend => "libsecret";
    public string? Warning => null;

    /// <summary>True when secret-tool exists and its keyring answers (a not-found lookup exits 1 with no stderr).</summary>
    public static bool IsUsable()
    {
        try
        {
            var probe = VaultProcess.Run("secret-tool", ["lookup", "service", TokenVault.Service, "account", "probe"]);
            return probe.Exit == 0 || (probe.Exit == 1 && probe.Stderr.Trim().Length == 0);
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or IOException or InvalidOperationException) { return false; }
    }

    public string? Get(string key)
    {
        var result = VaultProcess.Run("secret-tool", ["lookup", "service", TokenVault.Service, "account", key]);
        return result.Exit == 0 && result.Stdout.Length > 0 ? result.Stdout.TrimEnd('\n') : null;
    }

    public void Set(string key, string value)
    {
        var result = VaultProcess.Run("secret-tool", ["store", $"--label=CodeChroma {key}", "service", TokenVault.Service, "account", key], value);
        if (result.Exit != 0) throw new IOException($"libsecret write failed: {result.Stderr.Trim()}");
    }

    public void Delete(string key) => VaultProcess.Run("secret-tool", ["clear", "service", TokenVault.Service, "account", key]);
}

internal static class VaultProcess
{
    public readonly record struct Result(int Exit, string Stdout, string Stderr);

    public static Result Run(string file, string[] args, string? stdin = null)
    {
        var info = new ProcessStartInfo(file)
        {
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = stdin is not null, UseShellExecute = false,
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new InvalidOperationException($"could not start {file}");
        if (stdin is not null)
        {
            process.StandardInput.Write(stdin);
            process.StandardInput.Close();
        }
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(10_000))
        {
            try { process.Kill(); } catch (InvalidOperationException) { }
            return new Result(-1, "", $"{file} timed out");
        }
        return new Result(process.ExitCode, stdout.Result, stderr.Result);
    }
}
