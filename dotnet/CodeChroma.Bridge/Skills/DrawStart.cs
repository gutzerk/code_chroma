using CodeChroma.Bridge.Context;

namespace CodeChroma.Bridge.Skills;

/// <summary>How a drawing window launches: its first prompt, the banner printed before the CLI, whether it runs bare (with the prompt it shows), and the drawer delegation.</summary>
public sealed record DrawStart(string? TaskText, string? Banner, bool Bare, string? Visible, DrawDelegation? Delegation)
{
    /// <summary>The launch of a drawing window; <paramref name="resumed"/> covers resume and fork, <paramref name="delegates"/> a real claude CLI, and a missing draw skill leaves <paramref name="taskText"/> as it was.</summary>
    public static DrawStart Plan(string diagramType, string? request, string? taskText, bool resumed, bool delegates, bool splitsSystemPrompt, string root, string workspaceId, string? contextCommand)
    {
        var requested = !string.IsNullOrWhiteSpace(request);
        var openStart = !requested && !resumed && diagramType == DiagramContext.AnyType && BareSkill.Enabled();
        // A normal agent hands drawing to the drawer subagent; a resume or fork passes the drawer again (the CLI does not store it).
        if (delegates && BareSkill.ComposeDelegation(diagramType, root, workspaceId, contextCommand, openStart, request) is { } delegation)
            return resumed
                ? new(taskText, null, false, null, delegation)
                : new(requested ? request : openStart ? null : BareSkill.InteractiveVisiblePrompt, openStart ? BareSkill.InteractiveQuestion : null, false, null, delegation);
        // A resumed or forked session gets no bare --system-prompt, so the skill rides as the prompt and nothing waits on the question.
        var asksInTerminal = openStart && splitsSystemPrompt;
        if (taskText is null || BareSkill.ComposeInteractive(diagramType, root, workspaceId, contextCommand, asksInTerminal, request) is not { } composed)
            return new(taskText, null, false, null, null);
        var bare = BareSkill.Enabled();
        var visible = bare ? (requested ? request : asksInTerminal ? "" : BareSkill.InteractiveVisiblePrompt) : null;
        return new(composed, asksInTerminal ? BareSkill.InteractiveQuestion : null, bare, visible, null);
    }
}
