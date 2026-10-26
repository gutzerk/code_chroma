using System.Diagnostics;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

[Collection("Git SSH environment")]
public class RepositoryCloneTests
{
    [Theory]
    [InlineData("https://github.com/owner/project.git", "project")]
    [InlineData(" https://gitlab.com/group/project/ ", "project")]
    [InlineData("git@example.com:team/project.git", "project")]
    [InlineData("ssh://git@example.com:2222/team/project.git", "project")]
    public void Accepts_remote_addresses_and_suggests_a_folder(string remote, string name)
    {
        var problem = RepositoryClone.ValidateRemote(remote);
        var suggested = RepositoryClone.SuggestedName(remote);

        Assert.Null(problem);
        Assert.Equal(name, suggested);
    }

    [Theory]
    [InlineData("")]
    [InlineData("--upload-pack=evil")]
    [InlineData("ext::command")]
    [InlineData("https://host")]
    [InlineData("https://user:secret@host/repo.git")]
    [InlineData("https://host/repo.git?token=secret")]
    [InlineData("https://host/repo.git\n--option")]
    public void Rejects_invalid_or_credential_bearing_addresses(string remote) =>
        Assert.NotNull(RepositoryClone.ValidateRemote(remote));

    [Fact]
    public async Task Clones_a_real_repository_with_history_and_origin_into_a_path_with_spaces()
    {
        using var temp = new TempDir();
        var source = CreateSource(temp);
        var parent = temp.Dir("destination with spaces");

        var path = await RepositoryClone.CloneAsync(source, parent, "project & copy");
        var head = Git(path, "log", "-1", "--format=%s");
        var origin = Git(path, "remote", "get-url", "origin");

        Assert.Equal(Path.Combine(parent, "project & copy"), path);
        Assert.Equal("hello", File.ReadAllText(Path.Combine(path, "README.md")));
        Assert.Equal("initial", head);
        Assert.Equal(source.Replace('\\', '/'), origin.Replace('\\', '/'));
        Assert.Single(Directory.GetFileSystemEntries(parent));
    }

    [Fact]
    public async Task Refuses_an_existing_destination_without_changing_it()
    {
        using var temp = new TempDir();
        var source = CreateSource(temp);
        var parent = temp.Dir("destination");
        var existing = temp.Dir("destination", "project");
        File.WriteAllText(Path.Combine(existing, "keep.txt"), "keep");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => RepositoryClone.CloneAsync(source, parent, "project"));

        Assert.Contains("already exists", error.Message);
        Assert.Equal("keep", File.ReadAllText(Path.Combine(existing, "keep.txt")));
        Assert.Single(Directory.GetFileSystemEntries(parent));
    }

    [Fact]
    public async Task Failed_clone_reports_git_error_and_leaves_no_partial_project()
    {
        using var temp = new TempDir();
        var source = temp.Dir("not a repository");
        var parent = temp.Dir("destination");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => RepositoryClone.CloneAsync(source, parent, "project"));

        Assert.Contains("Could not clone", error.Message);
        Assert.Contains("fatal:", error.Message);
        Assert.Contains("not a repository", error.Message);
        Assert.Empty(Directory.GetFileSystemEntries(parent));
    }

    [Theory]
    [InlineData("core.sshCommand")]
    [InlineData("GIT_SSH")]
    [InlineData("GIT_SSH_COMMAND")]
    public async Task Honors_configured_ssh_clients_without_contacting_a_remote(string setting)
    {
        using var temp = new TempDir();
        var parent = temp.Dir("destination");
        var script = temp.Sub(OperatingSystem.IsWindows() ? "ssh client.cmd" : "ssh client.sh");
        File.WriteAllText(script, OperatingSystem.IsWindows()
            ? "@echo codechroma-configured-ssh 1>&2\r\n@exit /b 1\r\n"
            : "#!/bin/sh\necho codechroma-configured-ssh >&2\nexit 1\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(script, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var command = "echo codechroma-configured-ssh >&2; exit 1 #";
        var variables = new[] { "GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM" };
        var original = variables.ToDictionary(key => key, Environment.GetEnvironmentVariable);
        try
        {
            Environment.SetEnvironmentVariable("GIT_SSH", null);
            Environment.SetEnvironmentVariable("GIT_SSH_COMMAND", null);
            Environment.SetEnvironmentVariable("GIT_SSH_VARIANT", "simple");
            Environment.SetEnvironmentVariable("GIT_CONFIG_GLOBAL", temp.Sub("empty-config"));
            Environment.SetEnvironmentVariable("GIT_CONFIG_NOSYSTEM", "1");
            if (setting == "core.sshCommand") Git(parent, "config", "--global", setting, command);
            else Environment.SetEnvironmentVariable(setting, setting == "GIT_SSH" ? script : command);

            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => RepositoryClone.CloneAsync("ssh://git@example.invalid/team/project.git", parent, "project"));

            Assert.True(error.Message.Contains("codechroma-configured-ssh"), error.Message);
            Assert.False(Directory.Exists(Path.Combine(parent, "project")));
            Assert.Empty(Directory.GetDirectories(parent, ".codechroma-clone-*"));
        }
        finally
        {
            foreach (var (key, value) in original) Environment.SetEnvironmentVariable(key, value);
        }
    }

    [Fact]
    public async Task Cancellation_stops_git_and_removes_the_partial_clone()
    {
        using var temp = new TempDir();
        using var cancellation = new CancellationTokenSource();
        var source = CreateSource(temp);
        var parent = temp.Dir("destination");
        var progress = new CancelOnProgress(cancellation);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => RepositoryClone.CloneAsync(source, parent, "project", progress, cancellation.Token));

        Assert.True(cancellation.IsCancellationRequested);
        Assert.Empty(Directory.GetFileSystemEntries(parent));
    }

    [Theory]
    [InlineData("../escape")]
    [InlineData("..")]
    [InlineData("")]
    public async Task Invalid_destination_names_never_create_files(string name)
    {
        using var temp = new TempDir();

        await Assert.ThrowsAsync<InvalidOperationException>(() => RepositoryClone.CloneAsync("https://example.com/team/repo.git", temp.Path, name));

        Assert.Empty(Directory.GetFileSystemEntries(temp.Path));
    }

    private sealed class CancelOnProgress(CancellationTokenSource cancellation) : IProgress<string>
    {
        public void Report(string value) => cancellation.Cancel();
    }

    private static string CreateSource(TempDir temp)
    {
        var source = temp.Dir("source repository");
        Git(source, "init");
        File.WriteAllText(Path.Combine(source, "README.md"), "hello");
        Git(source, "add", "README.md");
        Git(source, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "initial");
        return source;
    }

    private static string Git(string root, params string[] args)
    {
        var start = new ProcessStartInfo("git") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var git = Process.Start(start)!;
        var output = git.StandardOutput.ReadToEnd();
        var error = git.StandardError.ReadToEnd();
        git.WaitForExit();
        if (git.ExitCode != 0) throw new InvalidOperationException(error);
        return output.Trim();
    }
}

[CollectionDefinition("Git SSH environment", DisableParallelization = true)]
public sealed class GitSshEnvironmentCollection { }
