using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>The diagram type and request a Draw launch carries on POST /agents, validated the way routes/agents.py does.</summary>
public sealed record DiagramHint(string? Type, string? Request, string? Error)
{
    public static DiagramHint Parse(JsonObject body)
    {
        string? type = null;
        if (body["diagram_type"] is { } rawType)
        {
            if (Json.Str(rawType) is not { } t || !DiagramKinds.Ids.Contains(t)) return Failed($"unknown diagram_type: {Json.Str(rawType) ?? rawType.ToJsonString()}");
            type = t;
        }
        string? request = null;
        if (body["diagram_request"] is { } rawRequest)
        {
            if (Json.Str(rawRequest) is not { } r) return Failed("diagram_request must be a string");
            if (r.Trim().Length > DiagramKinds.MaxRequestChars) return Failed($"diagram_request must be at most {DiagramKinds.MaxRequestChars} characters");
            request = AgentRecord.CleanContext(r);
        }
        return new DiagramHint(type, request, null);
    }

    private static DiagramHint Failed(string error) => new(null, null, error);
}
