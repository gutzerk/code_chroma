using System.Text;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Skills;

/// <summary>Turns a `/skill args` slash-command prompt into a self-contained prompt, so the CLI needs no skill registration or other context.</summary>
public static partial class BareSkill
{
    private const string DisableEnv = "codechroma_BARE_AGENTS";
    private const string DrawSkill = "codechroma-draw-diagram";

    /// <summary>The loopback URL this bridge listens on, set once the server is up; short skills embed it so the agent needs no environment.</summary>
    public static string? BridgeUrl { get; set; }

    /// <summary>The kill switch for bare runs: set codechroma_BARE_AGENTS=0 to fall back to registered-skill runs.</summary>
    public static bool Enabled() => Environment.GetEnvironmentVariable(DisableEnv)?.Trim() != "0";

    /// <summary>The inlined prompt; a prompt that is not a slash command comes back unchanged, and null means its skill is not installed (the run then stays as it was).</summary>
    public static string? Compose(string prompt, string repoRoot, string workspaceId)
    {
        if (SlashCommand().Match(prompt) is not { Success: true } match) return prompt;
        var skill = match.Groups[1].Value;
        var args = match.Groups[2].Value.Trim();
        if (SkillSync.SkillSource(skill) is not { } source || !File.Exists(Path.Combine(source, "SKILL.md"))) return null;
        var text = new StringBuilder();
        text.Append("Repository root: ").AppendLine(repoRoot).AppendLine();
        if (ShortBody(skill, args, source) is { } kind)
        {
            text.AppendLine(Fill(File.ReadAllText(kind.File), kind.Type, source, repoRoot, workspaceId)).AppendLine();
            return text.Append("Task: ").Append(ReadInstruction().Replace(DiagramType().Replace(args, "").Trim(), "").Trim()).ToString();
        }
        text.AppendLine($"The `{skill}` skill follows; apply it to the task at the end. Files it names under `references/` and `scripts/` are inlined or live in `.claude/skills/{skill}/` under the repository root.").AppendLine();
        text.AppendLine(StripFrontmatter(File.ReadAllText(Path.Combine(source, "SKILL.md")))).AppendLine();
        foreach (var name in References().Matches(args).Select(m => m.Value).Distinct())
            if (Path.Combine(source, name) is var file && File.Exists(file))
                text.AppendLine($"## {name}").AppendLine().AppendLine(File.ReadAllText(file)).AppendLine();
        return text.Append("Task: ").Append(args).ToString();
    }

    /// <summary>The short first message an interactive diagram window shows; the inlined skill itself rides in the hidden system prompt.</summary>
    public const string InteractiveVisiblePrompt = "Help me draw a diagram of this project.";

    /// <summary>The question the bridge prints in an open ("any") drawing agent's window before its CLI starts; the user's reply is the agent's first message.</summary>
    public const string InteractiveQuestion = "\u001b[1mWhat do you want to see?\u001b[0m A flow, a component, a feature... or just ask for the whole project.\r\n\r\n";

    /// <summary>The first message of an interactive diagram agent (`askedInTerminal` when the bridge already printed the question in the window): its short body inlined (the open "any" start's body loads no skill until the user answers), else the whole skill; no other context.</summary>
    public static string? ComposeInteractive(string type, string repoRoot, string workspaceId, string? contextCommand, bool askedInTerminal = false,
        string? request = null)
    {
        if (SkillSync.SkillSource(DrawSkill) is not { } source || !File.Exists(Path.Combine(source, "SKILL.md"))) return null;
        var text = new StringBuilder();
        text.Append("Repository root: ").AppendLine(repoRoot).AppendLine();
        var bodyType = type == PlanType ? "impact" : type;
        var shortBody = Path.Combine(source, "references", $"bare-{bodyType}.md");
        if (File.Exists(shortBody)) text.AppendLine(Fill(File.ReadAllText(shortBody), bodyType, source, repoRoot, workspaceId));
        else
        {
            text.AppendLine($"The `{DrawSkill}` skill follows. Files it names under `references/` and `scripts/` are in `{source}`; read them by those absolute paths.").AppendLine();
            text.AppendLine(StripFrontmatter(File.ReadAllText(Path.Combine(source, "SKILL.md"))));
        }
        text.AppendLine().AppendLine("## How this session starts").AppendLine();
        if (!string.IsNullOrWhiteSpace(request))
        {
            text.AppendLine(RequestedStart(type, request, source));
            if (contextCommand is not null)
                text.AppendLine($"Run `{contextCommand} \"phrase\" \"phrase\" ...` first with 3-6 short phrases taken from that request (one component, flow or concept each), read its output, then draw from it and open a file only to confirm a detail.");
            return text.ToString();
        }
        if (askedInTerminal) text.AppendLine("The terminal already asked the user what they want to see; their first message is the answer. Do not greet or ask again.");
        else text.AppendLine("The user has not said yet what to draw. Greet them in one short line and ask what they want to see (the whole project is a fine answer). Do nothing else until they answer.");
        if (contextCommand is not null)
            text.AppendLine($"{(askedInTerminal ? "Start by running" : "Once they answer, run")} `{contextCommand} \"phrase\" \"phrase\" ...` with 3-6 short phrases taken from their request (one component, flow or concept each), read its output, then draw from it and open a file only to confirm a detail.");
        return text.ToString();
    }

    /// <summary>The Draw dialog's "plan" kind: a mode of the impact type, drawn by the impact body plus feature-plan-mode.md.</summary>
    public const string PlanType = "plan";

    /// <summary>The start block of a drawing agent whose user already picked a type and said what to show (scope is in their words): no greeting, no question.</summary>
    private static string RequestedStart(string type, string request, string source)
    {
        var text = new StringBuilder();
        text.Append(type == DiagramContext.AnyType
            ? "The user did not pick a diagram type; choose the one that fits."
            : $"The user picked the `{(type == PlanType ? "feature plan" : type)}` diagram type.");
        text.AppendLine().AppendLine().AppendLine("Their request:").AppendLine().AppendLine(request.Trim()).AppendLine();
        if (type == PlanType)
            text.AppendLine($"Follow `{Path.Combine(source, "references", "feature-plan-mode.md")}` for the planned blocks.");
        text.AppendLine("This request is their answer: do not greet them or ask what to draw. The picked type is a hint, not a lock: if the request clearly fits another type better, say so in one line, but draw the picked type unless they agree.");
        return text.ToString();
    }

    /// <summary>`references/bare-<type>.md` when the draw skill has a short body for the `type:` named in the args.</summary>
    private static (string Type, string File)? ShortBody(string skill, string args, string source)
    {
        if (skill != DrawSkill || DiagramType().Match(args) is not { Success: true } m) return null;
        var type = m.Groups[1].Value;
        var file = Path.Combine(source, "references", $"bare-{type}.md");
        return File.Exists(file) ? (type, file) : null;
    }

    /// <summary>The command that runs the draw skill's self-check script with the given arguments.</summary>
    public static string CheckCommand(string skillSource, string arguments) =>
        $"{(OperatingSystem.IsWindows() ? "python" : "python3")} \"{Path.Combine(skillSource, "scripts", "check_diagram.py")}\" {arguments}";

    private static string Fill(string body, string type, string source, string repoRoot, string workspaceId)
    {
        var bridge = BridgeUrl ?? "http://localhost:8000";
        return body.Replace("{SKILL_DIR}", source).Replace("{BRIDGE}", bridge).Replace("{WORKSPACE}", workspaceId).Replace("{REPO_ROOT}", repoRoot)
            .Replace("{OUTPUT_PATH}", Workspace.DiagramPath(repoRoot, type)).Replace("{CHECK_COMMAND}", CheckCommand(source, $"--kind {type} --url {bridge} --repo {workspaceId}"));
    }

    private static string StripFrontmatter(string markdown)
    {
        if (!markdown.StartsWith("---")) return markdown;
        var end = markdown.IndexOf("\n---", 3, StringComparison.Ordinal);
        return end < 0 ? markdown : markdown[(end + 4)..].TrimStart('\r', '\n');
    }

    [GeneratedRegex(@"\A/([A-Za-z0-9_\-]+)(?:\s+(.*))?\z", RegexOptions.Singleline)]
    private static partial Regex SlashCommand();

    [GeneratedRegex(@"\Atype:\s*([a-z0-9\-]+)")]
    private static partial Regex DiagramType();

    /// <summary>The "— read references/… before writing anything —" clause of a registered-skill prompt, which a short body makes wrong.</summary>
    [GeneratedRegex(@"—\s*read references/.*?before writing anything\s*—", RegexOptions.Singleline)]
    private static partial Regex ReadInstruction();

    [GeneratedRegex(@"references/[\w.\-]+\.md")]
    private static partial Regex References();
}
