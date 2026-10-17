using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

var builder = WebApplication.CreateBuilder(args);

var repoRoot = Path.GetFullPath(builder.Configuration["Bridge:RepoRoot"] ?? Environment.GetEnvironmentVariable("codechroma_BRIDGE_REPO_PATH") ?? ".");
var allowedOrigins = (Environment.GetEnvironmentVariable("codechroma_BRIDGE_CORS_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
    .Split(',').Select(o => o.Trim()).Where(o => o.Length > 0).ToHashSet();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IAnalysisExporter>(_ => new PythonAnalysisExporter());
builder.Services.AddSingleton<IEngineFactory, CoreEngineFactory>();
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddSingleton<TraceConnections>();
builder.Services.AddSingleton(UserPaths.FromEnvironment());
builder.Services.AddSingleton<ProviderStore>();
builder.Services.AddSingleton<CallSiteStore>();
builder.Services.AddSingleton<DiagramLibrary>();
builder.Services.AddSkillServices();
builder.Services.AddSingleton(new BranchManager(repoRoot));
builder.Services.AddSingleton(sp =>
{
    var connections = sp.GetRequiredService<ConnectionManager>();
    var registry = new WorkspaceRegistry(
        repoRoot,
        sp.GetRequiredService<IEngineFactory>(),
        (key, message) => connections.BroadcastDetached(message, key),
        sp.GetRequiredService<TimeProvider>(),
        startWatchers: true);
    var branches = sp.GetRequiredService<BranchManager>();
    branches.Reconcile();
    foreach (var record in branches.List()) registry.Register(record.Id, record.Worktree);
    return registry;
});
builder.Services.AddHostedService<RegistryLifecycle>();
builder.Services.AddCors();

var app = builder.Build();

app.UseWebSockets();
app.UseCors(policy => policy.WithOrigins([.. allowedOrigins]).WithMethods("GET", "POST", "PUT", "PATCH", "DELETE").AllowAnyHeader());
app.UseMiddleware<OriginGuard>((IReadOnlySet<string>)allowedOrigins);

WorkspaceAndSocketRoutes.Map(app, repoRoot);
GraphRoutes.Map(app);
DiagramRoutes.Map(app);
AssistantRoutes.Map(app);
RuntimeRoutes.Map(app);
LlmSettingsRoutes.Map(app);
TraceRoutes.Map(app);
IssueRoutes.Map(app);
DiagramTypeRoutes.Map(app);
BranchRoutes.Map(app, repoRoot);

app.Run();

/// <summary>Starts the watchers with the host and sweeps idle workspaces every minute.</summary>
internal sealed class RegistryLifecycle(WorkspaceRegistry registry) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        registry.StartAll();
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(BridgeLimits.IdleSweepSeconds));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken)) registry.UnloadIdle();
        }
        catch (OperationCanceledException) { }
    }

    public override Task StopAsync(CancellationToken cancellationToken)
    {
        registry.Dispose();
        return base.StopAsync(cancellationToken);
    }
}

public partial class Program;
