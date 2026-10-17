using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;

namespace CodeChroma.Bridge.Workspaces;

public static class BridgeLimits
{
    public const int IdleUnloadSeconds = 0;
    public const int RepoDebounceMs = 0;
    public const int WatcherDebounceMs = 0;
    public const int GitShortTimeoutSeconds = 0;
    public const int GitLongTimeoutSeconds = 0;
    public const int SocketSendTimeoutSeconds = 0;
}

public sealed record WorkspaceState(string State, string Progress, string? Error);

public sealed class Workspace
{
}

public sealed class WorkspaceRegistry
{
    public WorkspaceRegistry(string mainRoot, IEngineFactory factory, Action<string, JsonObject> onEvent, TimeProvider time, bool startWatchers) =>
        throw new NotImplementedException();

    public Workspace Main => throw new NotImplementedException();
    public Workspace Get(string id) => throw new NotImplementedException();
    public void Register(string id, string root) => throw new NotImplementedException();
    public IReadOnlyList<string> UnloadIdle() => throw new NotImplementedException();
    public bool IsLive(string id) => throw new NotImplementedException();
    public WorkspaceState State(string id) => throw new NotImplementedException();
}

public sealed class Debouncer : IDisposable
{
    public Debouncer(TimeSpan quiet, Action fire) => throw new NotImplementedException();
    public void Trigger() => throw new NotImplementedException();
    public void Dispose() { }
}
