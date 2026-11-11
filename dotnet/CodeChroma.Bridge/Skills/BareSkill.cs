using System.Text;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Agents;
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
        text.AppendLine($"The `{skill}` skill follows; apply it to the task at the end. Files it names under `references/` and `scripts/` are inlined or live in `{SkillSync.SkillTargets[0]}/{skill}/` under the repository root.").AppendLine();
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
        if (DrawBody(type, repoRoot, workspaceId) is not var (body, source)) return null;
        var text = new StringBuilder(body);
        text.AppendLine().AppendLine("## How this session starts").AppendLine();
        if (!string.IsNullOrWhiteSpace(request))
        {
            text.AppendLine(RequestedStart(type, request, source));
            if (contextCommand is not null) text.AppendLine(ContextLine(contextCommand, "Start by running", "that request"));
            return text.ToString();
        }
        text.AppendLine(askedInTerminal ? AskedLine : $"{AskLine} Do nothing else until they answer.");
        if (contextCommand is not null) text.AppendLine(ContextLine(contextCommand, askedInTerminal ? "Start by running" : "Once they answer, run", "their request"));
        return text.ToString();
    }

    /// <summary>The plugin and agent name of the subagent a drawing window hands every drawing job to.</summary>
    public const string DrawerPlugin = "codechroma-draw";

    public const string DrawerAgent = "drawer";

    /// <summary>The drawer's subagent type, as the Agent tool lists it.</summary>
    public const string DrawerName = $"{DrawerPlugin}:{DrawerAgent}";

    public const string DrawerDescription = "Draws or changes a CodeChroma diagram on the user's canvas from a self-contained brief. Use for every diagram drawing job in this window.";

    /// <summary>A drawing window that runs as a normal agent and hands drawing to the drawer subagent: the lead instruction, its first-launch start block, and the drawer's own prompt.</summary>
    public static DrawDelegation? ComposeDelegation(string type, string repoRoot, string workspaceId, string? contextCommand, bool askedInTerminal = false, string? request = null)
    {
        if (DrawBody(type, repoRoot, workspaceId) is not var (body, source)) return null;
        var drawer = new StringBuilder(body);
        drawer.AppendLine().AppendLine("## How you work").AppendLine();
        drawer.AppendLine("You are the diagram drawer, a subagent. The brief from the main agent is the user's request. You cannot ask the user anything: make a reasonable choice and say it in your report.");
        if (contextCommand is not null) drawer.AppendLine(ContextLine(contextCommand, "Start by running", "the brief"));
        if (type == PlanType) drawer.AppendLine(PlanLine(source));
        drawer.AppendLine(TitleRule);
        drawer.AppendLine("Run the self-check until it passes. End with a short report: the diagram type, its title, what it shows, and anything you left out or guessed.");
        return new DrawDelegation(Lead(type), LeadStart(askedInTerminal, request), drawer.ToString());
    }

    /// <summary>The main agent's standing part of a drawing window: hand drawing to the drawer and ask the user first.</summary>
    private static string Lead(string type) => new StringBuilder()
        .AppendLine("## Drawing diagrams in this window").AppendLine()
        .AppendLine($"This window draws CodeChroma diagrams on the user's canvas. Hand every drawing job (a new diagram, a redraw, a change the user asks for) to the `{DrawerName}` subagent through the Agent tool. It already has the diagram rules, the output file, the self-check and the context tool, so do not read the draw skill or write the diagram yourself.")
        .AppendLine("The drawer cannot ask the user anything. Settle open questions with the user first, then give it one self-contained brief: the diagram type, the user's request in their own words, the scope and anything they ruled out. When it returns, tell the user in a few lines what was drawn. For a follow-up change, send it a new brief that names the existing diagram and the change.")
        .AppendLine("Outside drawing, work as usual: the project's skills, tools and instructions all apply.").AppendLine()
        .AppendLine(type == DiagramContext.AnyType ? "The user did not pick a diagram type; the drawer chooses the one that fits." : $"The window draws the `{TypeName(type)}` diagram type.")
        .ToString();

    /// <summary>How a drawing window's first launch starts; a resume or fork leaves it out.</summary>
    private static string LeadStart(bool askedInTerminal, string? request)
    {
        var text = new StringBuilder().AppendLine("## How this session starts").AppendLine();
        if (!string.IsNullOrWhiteSpace(request))
            return text.AppendLine("The user's request:").AppendLine().AppendLine(request.Trim()).AppendLine()
                .AppendLine($"This request is their answer: do not greet them or ask what to draw. {HintRule} Hand the drawer its brief now.").ToString();
        return text.AppendLine(askedInTerminal ? $"{AskedLine} Hand the drawer its brief." : $"{AskLine} Hand the drawer its brief once they answer.").ToString();
    }

    private const string AskedLine = "The terminal already asked the user what they want to see; their first message is the answer. Do not greet or ask again.";

    private const string AskLine = "The user has not said yet what to draw. Greet them in one short line and ask what they want to see (the whole project is a fine answer).";

    private const string HintRule = "The picked type is a hint, not a lock: if the request clearly fits another type better, say so in one line, but draw the picked type unless they agree.";

    private const string TitleRule = "Name the diagram from this request: its top-level `title` says what it shows, in the request's language, and differs from the titles already on the canvas — never just the type name.";

    private static string TypeName(string type) => type == PlanType ? "feature plan" : type;

    private static string PlanLine(string source) => $"Follow `{Path.Combine(source, "references", "feature-plan-mode.md")}` for the planned blocks.";

    /// <summary>The instruction to run the context tool with phrases taken from <paramref name="from"/>, then draw from its output.</summary>
    private static string ContextLine(string command, string verb, string from) =>
        $"{verb} `{command} \"phrase\" \"phrase\" ...` with 3-6 short phrases taken from {from} (one component, flow or concept each), read its output, then draw from it and open a file only to confirm a detail.";

    /// <summary>The draw skill for one type with its placeholders filled (the short body when there is one, else the whole skill) and the skill folder; null when the skill is not installed.</summary>
    private static (string Body, string Source)? DrawBody(string type, string repoRoot, string workspaceId)
    {
        if (SkillSync.SkillSource(DrawSkill) is not { } source || !File.Exists(Path.Combine(source, "SKILL.md"))) return null;
        var text = new StringBuilder();
        text.Append("Repository root: ").AppendLine(repoRoot).AppendLine();
        var bodyType = type == PlanType ? "impact" : type;
        var shortBody = Path.Combine(source, "references", $"bare-{bodyType}.md");
        if (File.Exists(shortBody)) return (text.AppendLine(Fill(File.ReadAllText(shortBody), bodyType, source, repoRoot, workspaceId)).ToString(), source);
        text.AppendLine($"The `{DrawSkill}` skill follows. Files it names under `references/` and `scripts/` are in `{source}`; read them by those absolute paths.").AppendLine();
        return (text.AppendLine(StripFrontmatter(File.ReadAllText(Path.Combine(source, "SKILL.md")))).ToString(), source);
    }

    /// <summary>The skill a "New workflow → With an agent" window gets inlined.</summary>
    public const string WorkflowSkill = "codechroma-workflow";

    /// <summary>The first message of a workflow-designing agent: the workflow skill with its placeholders filled, then the user's description; null when the skill is not installed.</summary>
    public static string? ComposeWorkflow(string repoRoot, string request)
    {
        if (SkillSync.SkillSource(WorkflowSkill) is not { } source || !File.Exists(Path.Combine(source, "SKILL.md"))) return null;
        var body = FillCommon(StripFrontmatter(File.ReadAllText(Path.Combine(source, "SKILL.md"))), source, repoRoot, Workspace.MainId);
        return new StringBuilder()
            .Append("Repository root: ").AppendLine(repoRoot).AppendLine()
            .AppendLine(body).AppendLine()
            .AppendLine("## How this session starts").AppendLine()
            .AppendLine("The user described the workflow they want:").AppendLine()
            .AppendLine(request.Trim()).AppendLine()
            .AppendLine("This description is their first message: do not greet them or ask what they want. Start with step 1.")
            .ToString();
    }

    /// <summary>The Draw dialog's "plan" kind: a mode of the impact type, drawn by the impact body plus feature-plan-mode.md.</summary>
    public const string PlanType = "plan";

    /// <summary>The start block of a drawing agent whose user already picked a type and said what to show (scope is in their words): no greeting, no question.</summary>
    private static string RequestedStart(string type, string request, string source)
    {
        var text = new StringBuilder();
        text.Append(type == DiagramContext.AnyType
            ? "The user did not pick a diagram type; choose the one that fits."
            : $"The user picked the `{TypeName(type)}` diagram type.");
        text.AppendLine().AppendLine().AppendLine("Their request:").AppendLine().AppendLine(request.Trim()).AppendLine();
        if (type == PlanType) text.AppendLine(PlanLine(source));
        text.AppendLine($"This request is their answer: do not greet them or ask what to draw. {HintRule}");
        text.AppendLine(TitleRule);
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
        return FillCommon(body, source, repoRoot, workspaceId)
            .Replace("{OUTPUT_PATH}", Workspace.DiagramPath(repoRoot, type)).Replace("{CHECK_COMMAND}", CheckCommand(source, $"--kind {type} --url {Bridge} --repo {workspaceId}"));
    }

    private static string Bridge => BridgeUrl ?? "http://localhost:8000";

    /// <summary>The placeholders every skill body shares, whatever diagram type (if any) it draws.</summary>
    private static string FillCommon(string body, string source, string repoRoot, string workspaceId) =>
        body.Replace("{SKILL_DIR}", source).Replace("{BRIDGE}", Bridge).Replace("{WORKSPACE}", workspaceId).Replace("{REPO_ROOT}", repoRoot);

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

/// <summary>A drawing window split in two: <paramref name="Lead"/> (plus <paramref name="Start"/> on a first launch) is appended to the main agent's system prompt, <paramref name="DrawerPrompt"/> is the drawer subagent's prompt.</summary>
public sealed record DrawDelegation(string Lead, string Start, string DrawerPrompt);
