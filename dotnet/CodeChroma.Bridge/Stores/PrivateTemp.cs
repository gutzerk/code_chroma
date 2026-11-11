namespace CodeChroma.Bridge.Stores;

/// <summary>A per-process 0700 temp dir (mkdtemp) that also removes this prefix's old dirs left by earlier runs.</summary>
public sealed class PrivateTemp(string prefix)
{
    /// <summary>How long an earlier run's dir is kept: any session launched from it has long ended by then.</summary>
    public static readonly TimeSpan LeftoverAge = TimeSpan.FromDays(7);

    private readonly object _gate = new();
    private string? _directory;

    /// <summary>This process's dir, made on first use (or after it vanished), sweeping old leftovers at that moment.</summary>
    public string Get()
    {
        lock (_gate)
        {
            if (_directory is not null && Directory.Exists(_directory)) return _directory;
            _directory = Directory.CreateTempSubdirectory(prefix).FullName;
            Sweep(Path.GetTempPath(), prefix, _directory, DateTime.UtcNow);
            return _directory;
        }
    }

    /// <summary>Deletes dirs under <paramref name="parent"/> named <paramref name="prefix"/>* last written before <paramref name="now"/> minus LeftoverAge, except <paramref name="keep"/>; ones it cannot remove stay.</summary>
    public static void Sweep(string parent, string prefix, string? keep, DateTime now)
    {
        try
        {
            foreach (var old in Directory.EnumerateDirectories(parent, prefix + "*"))
            {
                if (old == keep || now - Directory.GetLastWriteTimeUtc(old) < LeftoverAge) continue;
                try { Directory.Delete(old, recursive: true); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }
}
