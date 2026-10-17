using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

public enum ShellOs { Windows, MacOs, Linux }

public enum ShellArch { X64, Arm64 }

public readonly record struct ShellPlatform(ShellOs Os, ShellArch Arch)
{
    public static ShellPlatform Current { get; } = new(
        OperatingSystem.IsWindows() ? ShellOs.Windows : OperatingSystem.IsMacOS() ? ShellOs.MacOs : ShellOs.Linux,
        RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? ShellArch.Arm64 : ShellArch.X64);
}

public sealed partial class SemVer
{
    [GeneratedRegex(@"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$")]
    private static partial Regex Pattern();

    public long[] Base { get; }
    public string[] Pre { get; }
    public bool IsPrerelease => Pre.Length > 0;

    private SemVer(long[] numbers, string[] pre)
    {
        Base = numbers;
        Pre = pre;
    }

    public static bool TryParse(string? tag, out SemVer? version)
    {
        version = null;
        var match = Pattern().Match((tag ?? "").Trim());
        if (!match.Success) return false;
        var pre = match.Groups[4].Success ? match.Groups[4].Value.Split('.') : [];
        if (pre.Any(p => p.All(char.IsAsciiDigit) && p.Length > 1 && p[0] == '0')) return false;
        if (!long.TryParse(match.Groups[1].Value, out var major) || !long.TryParse(match.Groups[2].Value, out var minor)
            || !long.TryParse(match.Groups[3].Value, out var patch)) return false;
        version = new SemVer([major, minor, patch], pre);
        return true;
    }

    public static int CompareTags(string a, string b)
    {
        if (!TryParse(a, out var av) || !TryParse(b, out var bv)) throw new FormatException("Invalid semantic version");
        for (var i = 0; i < 3; i++)
            if (av!.Base[i] != bv!.Base[i]) return av.Base[i].CompareTo(bv.Base[i]);
        if (!av!.IsPrerelease || !bv!.IsPrerelease) return (!av.IsPrerelease).CompareTo(!bv!.IsPrerelease);
        for (var i = 0; i < Math.Max(av.Pre.Length, bv.Pre.Length); i++)
        {
            if (i >= av.Pre.Length) return -1;
            if (i >= bv.Pre.Length) return 1;
            var (x, y) = (av.Pre[i], bv.Pre[i]);
            if (x == y) continue;
            var (xn, yn) = (x.All(char.IsAsciiDigit), y.All(char.IsAsciiDigit));
            if (xn && yn) return System.Numerics.BigInteger.Parse(x).CompareTo(System.Numerics.BigInteger.Parse(y));
            if (xn != yn) return xn ? -1 : 1;
            return string.CompareOrdinal(x, y) < 0 ? -1 : 1;
        }
        return 0;
    }
}
