using System.Text;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Skills;

/// <summary>Turns a `/skill args` slash-command prompt into a self-contained prompt, so the CLI needs no skill registration or other context.</summary>
public static partial class BareSkill
{
    public const string DisableEnv = "codechroma_BARE_AGENTS";

    /// <summary>The kill switch for bare runs: set codechroma_BARE_AGENTS=0 to fall back to registered-skill runs.</summary>
    public static bool Enabled() => Environment.GetEnvironmentVariable(DisableEnv)?.Trim() != "0";

    /// <summary>The inlined prompt, or null when the prompt is not a slash command or its skill is not installed (then the run stays as it was).</summary>
    public static string? Compose(string prompt, string repoRoot)
    {
        if (SlashCommand().Match(prompt) is not { Success: true } match) return null;
        var skill = match.Groups[1].Value;
        var args = match.Groups[2].Value.Trim();
        if (SkillSync.SkillSource(skill) is not { } source || !File.Exists(Path.Combine(source, "SKILL.md"))) return null;
        var text = new StringBuilder();
        text.Append("Repository root: ").AppendLine(repoRoot).AppendLine();
        text.AppendLine($"The `{skill}` skill follows; apply it to the task at the end. Files it names under `references/` and `scripts/` are inlined or live in `.claude/skills/{skill}/` under the repository root.").AppendLine();
        text.AppendLine(StripFrontmatter(File.ReadAllText(Path.Combine(source, "SKILL.md")))).AppendLine();
        foreach (var name in References().Matches(args).Select(m => m.Value).Distinct())
            if (Path.Combine(source, name) is var file && File.Exists(file))
                text.AppendLine($"## {name}").AppendLine().AppendLine(File.ReadAllText(file)).AppendLine();
        return text.Append("Task: ").Append(args).ToString();
    }

    private static string StripFrontmatter(string markdown)
    {
        if (!markdown.StartsWith("---")) return markdown;
        var end = markdown.IndexOf("\n---", 3, StringComparison.Ordinal);
        return end < 0 ? markdown : markdown[(end + 4)..].TrimStart('\r', '\n');
    }

    [GeneratedRegex(@"\A/([A-Za-z0-9_\-]+)(?:\s+(.*))?\z", RegexOptions.Singleline)]
    private static partial Regex SlashCommand();

    [GeneratedRegex(@"references/[\w.\-]+\.md")]
    private static partial Regex References();
}
