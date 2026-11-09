using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>The task hints POST /agents carries: a Draw launch's diagram type and request (validated the way routes/agents.py does), or a "New workflow" description.</summary>
public sealed record DiagramHint(string? Type, string? Request, string? WorkflowRequest, string? Error)
{
    public static DiagramHint Parse(JsonObject body)
    {
        string? type = null;
        if (body["diagram_type"] is { } rawType)
        {
            if (Json.Str(rawType) is not { } t || !DiagramKinds.Ids.Contains(t)) return Failed($"unknown diagram_type: {Json.Str(rawType) ?? rawType.ToJsonString()}");
            type = t;
        }
        var (request, requestError) = ReadRequest(body, "diagram_request", allowBlank: true);
        if (requestError is not null) return Failed(requestError);
        var (workflow, workflowError) = ReadRequest(body, "workflow_request", allowBlank: false);
        if (workflowError is not null) return Failed(workflowError);
        if (workflow is not null && type is not null) return Failed("an agent draws a diagram or designs a workflow, not both");
        return new DiagramHint(type, request, workflow, null);
    }

    /// <summary>One optional request string: trimmed and cleaned, at most the Draw request limit.</summary>
    private static (string? Value, string? Error) ReadRequest(JsonObject body, string key, bool allowBlank)
    {
        if (body[key] is not { } raw) return (null, null);
        if (Json.Str(raw) is not { } text) return (null, $"{key} must be a string");
        var length = text.Trim().Length;
        if (!allowBlank && length == 0) return (null, $"{key} must be a non-empty string");
        if (length > DiagramKinds.MaxRequestChars) return (null, $"{key} must be at most {DiagramKinds.MaxRequestChars} characters");
        return (AgentRecord.CleanContext(text), null);
    }

    private static DiagramHint Failed(string error) => new(null, null, null, error);
}
