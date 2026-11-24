using CodeChroma.Bridge.Messages;

namespace CodeChroma.Bridge.Tests.Messages;

public class TokenVaultTests
{
    private static string TempFile() => Path.Combine(Path.GetTempPath(), "cc-vault-" + Guid.NewGuid().ToString("N")[..8], "tokens.json");

    [Fact]
    public void The_file_fallback_round_trips_and_warns()
    {
        var vault = new FileVault(TempFile(), "kept in a file");
        vault.Set(VaultKeys.SlackUserToken, "xoxp-1");

        var value = vault.Get(VaultKeys.SlackUserToken);

        Assert.Equal(("xoxp-1", "file", "kept in a file"), (value, vault.Backend, vault.Warning));
    }

    [Fact]
    public void The_file_fallback_is_readable_by_its_owner_only()
    {
        if (OperatingSystem.IsWindows()) return;
        var path = TempFile();
        var vault = new FileVault(path, null);

        vault.Set(VaultKeys.SlackAppToken, "xapp-1");

        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
    }

    [Fact]
    public void Deleting_the_last_key_removes_the_file()
    {
        var path = TempFile();
        var vault = new FileVault(path, null);
        vault.Set(VaultKeys.OutlookRefreshToken, "r");

        vault.Delete(VaultKeys.OutlookRefreshToken);

        Assert.False(File.Exists(path));
    }
}
