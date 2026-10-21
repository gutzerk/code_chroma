using CodeChroma.Bridge;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Embeddings;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

if (args.Length > 0 && args[0] == "context")
{
    Console.OutputEncoding = System.Text.Encoding.UTF8;
    return ContextTool.Run(args[1..], Console.Out, Console.Error);
}

var cli = BridgeCli.Parse(args);
var builder = WebApplication.CreateBuilder(cli.Remaining);
builder.Logging.SetMinimumLevel(LogLevel.Warning);
if (cli.Port is { } port) builder.WebHost.UseUrls($"http://127.0.0.1:{port}");

var repoRoot = Path.GetFullPath(cli.RepoPath ?? builder.Configuration["Bridge:RepoRoot"] ?? Environment.GetEnvironmentVariable("codechroma_BRIDGE_REPO_PATH") ?? ".");
var allowedOrigins = (Environment.GetEnvironmentVariable("codechroma_BRIDGE_CORS_ORIGINS") ?? "http://localhost:5173,http://127.0.0.1:5173")
    .Split(',').Select(o => o.Trim()).Where(o => o.Length > 0).ToHashSet();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IAnalysisExporter>(_ => new NativeAnalysisExporter());
builder.Services.AddSingleton<IEngineFactory, CoreEngineFactory>();
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddSingleton<TraceConnections>();
builder.Services.AddSingleton(UserPaths.FromEnvironment());
builder.Services.AddSingleton<ProviderStore>();
builder.Services.AddSingleton<CallSiteStore>();
builder.Services.AddSingleton<DiagramLibrary>();
builder.Services.AddSkillServices();
builder.Services.AddSingleton(_ => new ModelStore(ModelStore.DefaultDirectory(), new HttpClient()));
builder.Services.AddSingleton<ProcessDiagram>();
builder.Services.AddSingleton<DiagramContext>();
builder.Services.AddSingleton<WorkflowRunners>();
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
builder.Services.AddAgentsAndPrs(repoRoot);
builder.Services.AddCors();

var app = builder.Build();
SkillSync.InstallIntoWorktree(repoRoot);
app.Lifetime.ApplicationStarted.Register(() => BareSkill.BridgeUrl = BridgeAddress.Local(app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>()));

app.UseWebSockets();
var spaDir = Path.Combine(AppContext.BaseDirectory, "web");
if (Directory.Exists(spaDir))
{
    var spa = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(spaDir);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = spa });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = spa });
}
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
CanvasRoutes.Map(app);
RecipeRoutes.Map(app);
DiffRoutes.Map(app);
ImpactRoutes.Map(app);
WikiRoutes.Map(app);
AgentRoutes.Map(app, repoRoot);
PrRoutes.Map(app, repoRoot);
TerminalRoutes.Map(app, repoRoot);
LayoutRoutes.Map(app);
EpicsRoutes.Map(app);
ContextRoutes.Map(app);
WikiGeneralRoutes.Map(app);
WorkflowRoutes.Map(app);
ProcessDiagramRoutes.Map(app);
if (Environment.GetEnvironmentVariable("codechroma_MODEL_WARMUP")?.Trim() != "0") _ = Task.Run(() => app.Services.GetRequiredService<DiagramContext>().WarmModelAsync());

app.Run();
return 0;

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
