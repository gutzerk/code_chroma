using System.Text;
using System.Text.Json;

namespace CodeChroma.Shell;

public sealed record BranchChoice(string Name, bool Open, string? Workspace);

public sealed record BranchChoices(string? Current, List<BranchChoice> Branches);

public sealed record BranchWorkspaceRecord(string Id, string Branch, string Worktree);

public abstract record BranchRequest
{
    public sealed record Existing(string Branch) : BranchRequest;

    public sealed record Create(string NewBranch, string? StartPoint = null) : BranchRequest;
}

public abstract record BranchOutcome
{
    public sealed record Opened(BranchWorkspaceRecord Record) : BranchOutcome;

    public sealed record Held(string? Workspace, string Message) : BranchOutcome;

    public sealed record Failed(string Message) : BranchOutcome;
}

/// <summary>What the shell asks a running bridge about branches: which are free, and opening one in a worktree.</summary>
public sealed class BranchBridgeClient(HttpClient http)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public async Task<BranchChoices> FetchChoicesAsync(string origin, CancellationToken ct = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        using var response = await http.GetAsync($"{origin}/branches/choices", timeout.Token);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"could not list branches ({(int)response.StatusCode})");
        return JsonSerializer.Deserialize<BranchChoices>(await response.Content.ReadAsStringAsync(ct), Json)!;
    }

    public async Task<BranchOutcome> RequestWorkspaceAsync(string origin, BranchRequest request, CancellationToken ct = default)
    {
        var body = request switch
        {
            BranchRequest.Existing e => JsonSerializer.Serialize(new { branch = e.Branch }),
            BranchRequest.Create c => JsonSerializer.Serialize(new { new_branch = c.NewBranch, start_point = c.StartPoint }),
            _ => throw new ArgumentOutOfRangeException(nameof(request)),
        };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(120));
        HttpResponseMessage response;
        try
        {
            response = await http.PostAsync($"{origin}/branches", new StringContent(body, Encoding.UTF8, "application/json"), timeout.Token);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return new BranchOutcome.Failed(e.Message);
        }
        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            JsonDocument? payload = null;
            try { payload = JsonDocument.Parse(text); } catch (JsonException) { }
            using (payload)
            {
                if (response.IsSuccessStatusCode && payload is not null)
                    return new BranchOutcome.Opened(JsonSerializer.Deserialize<BranchWorkspaceRecord>(text, Json)!);
                if (payload is not null && payload.RootElement.ValueKind == JsonValueKind.Object && payload.RootElement.TryGetProperty("detail", out var d))
                {
                    if ((int)response.StatusCode == 409 && d.ValueKind == JsonValueKind.Object && d.TryGetProperty("workspace", out var ws))
                        return new BranchOutcome.Held(ws.ValueKind == JsonValueKind.String ? ws.GetString() : null,
                            d.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString()! : "branch is already open");
                    if (d.ValueKind == JsonValueKind.String) return new BranchOutcome.Failed(d.GetString()!);
                }
                return new BranchOutcome.Failed($"request failed ({(int)response.StatusCode})");
            }
        }
    }
}
