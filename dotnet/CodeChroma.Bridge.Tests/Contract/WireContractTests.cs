using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Contract;

/// <summary>Replays tests/fixtures/bridge_contract against the ASP.NET Core bridge (same cases as the Python runner).</summary>
public class WireContractTests
{
    public static IEnumerable<object[]> Cases => ContractCases.RunnableIds;

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Case_holds(string id)
    {
        var contractCase = ContractCases.ById(id);
        using var host = new BridgeHost(contractCase.Repo);
        var sockets = new Dictionary<string, Frames>();
        var failures = new List<string>();
        var variables = new Dictionary<string, string>();
        try
        {
            var number = 0;
            foreach (var node in contractCase.Steps)
            {
                number++;
                var step = Substitute(node!.AsObject(), variables);
                var found = step.ContainsKey("http") ? await RunHttp(host, step, variables)
                    : step.ContainsKey("fs") ? RunFs(host, step)
                    : await RunWs(host, step, sockets);
                failures.AddRange(found.Select(message => $"step {number}: {message}"));
                if (found.Count > 0) break;
            }
        }
        finally
        {
            foreach (var socket in sockets.Values) socket.Dispose();
        }
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    [Fact]
    public void Unsupported_cases_are_exactly_the_documented_set()
    {
        var ids = ContractCases.Unsupported.Select(c => c.Id).Order().ToArray();
        string[] realEngineOnly = ["graph::a_docs_only_folder_is_flagged_doc_only", "graph::binary_files_are_listed_with_null_source"];
        string[] documented =
        [
            "diagrams::an_unconvertible_legacy_c1_is_flagged_for_regeneration",
            "diagrams::c1_nodes_get_graph_node_ids_and_unmapped_code_is_listed",
            "graph::a_docs_only_folder_is_flagged_doc_only",
            "graph::binary_files_are_listed_with_null_source",
        ];
        // A case that needs nothing but the real engine is skipped without it and runs with it; no list to maintain.
        var needsOnlyRealEngine = ContractCases.All.Where(c => c.Requires.Length > 0 && c.Requires.All(r => r == "real-engine")).Select(c => c.Id);
        var expected = BridgeHost.RealEngine ? documented.Except(realEngineOnly) : documented.Union(needsOnlyRealEngine);
        Assert.Equal(expected.Order().ToArray(), ids);
    }

    /// <summary>Replaces "{{name}}" in every string of a step with the value an earlier step captured.</summary>
    private static JsonObject Substitute(JsonObject step, Dictionary<string, string> variables)
    {
        if (variables.Count == 0) return step;
        var text = step.ToJsonString();
        foreach (var (name, value) in variables)
            text = text.Replace("{{" + name + "}}", System.Text.Json.JsonSerializer.Serialize(value)[1..^1]);
        return JsonNode.Parse(text)!.AsObject();
    }

    private static async Task<List<string>> RunHttp(BridgeHost host, JsonObject step, Dictionary<string, string> variables)
    {
        var spec = step["http"]!.AsObject();
        var path = spec["path"]!.GetValue<string>();
        if (spec["query"] is JsonObject query)
            path += "?" + string.Join("&", query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value!.ToString())}"));
        using var request = new HttpRequestMessage(new HttpMethod(spec["method"]!.GetValue<string>()), path);
        foreach (var header in spec["headers"]?.AsObject() ?? [])
        {
            if (header.Key.Equals("host", StringComparison.OrdinalIgnoreCase)) request.Headers.Host = header.Value!.GetValue<string>();
            else request.Headers.TryAddWithoutValidation(header.Key, header.Value!.GetValue<string>());
        }
        if (spec["json"] is { } body)
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await host.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        var expect = step["expect"]?.AsObject() ?? [];
        var failures = new List<string>();
        if (expect["status"] is { } status && (int)response.StatusCode != status.GetValue<int>())
            failures.Add($"status {(int)response.StatusCode} != {status}: {text[..Math.Min(300, text.Length)]}");
        if (expect.ContainsKey("json") || expect.ContainsKey("checks"))
            failures.AddRange(ContractMatchers.ExpectationFailures(expect, text.Length == 0 ? null : JsonNode.Parse(text), host.Root));
        foreach (var (name, selector) in step["capture"]?.AsObject() ?? [])
        {
            var values = ContractMatchers.Select(text.Length == 0 ? null : JsonNode.Parse(text), selector!.GetValue<string>()).Values;
            variables[name] = values.Count > 0 ? values[0]?.ToString() ?? "" : "";
        }
        return failures;
    }

    private static List<string> RunFs(BridgeHost host, JsonObject step)
    {
        var target = Path.Combine(host.Root, step["path"]!.GetValue<string>());
        switch (step["fs"]!.GetValue<string>())
        {
            case "write":
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.WriteAllBytes(target, step["base64"] is { } b64
                    ? Convert.FromBase64String(b64.GetValue<string>())
                    : Encoding.UTF8.GetBytes(step["text"]!.GetValue<string>()));
                break;
            case "delete":
                if (File.Exists(target)) File.Delete(target);
                break;
            default:
                // Like Python's text-mode read/write: a CRLF checkout still matches a "\n" needle.
                var original = File.ReadAllText(target);
                var crlf = original.Contains("\r\n");
                string Fit(string text) => crlf ? text.Replace("\r\n", "\n").Replace("\n", "\r\n") : text;
                File.WriteAllText(target, original.Replace(Fit(step["find"]!.GetValue<string>()), Fit(step["with"]!.GetValue<string>())));
                break;
        }
        return [];
    }

    private static async Task<List<string>> RunWs(BridgeHost host, JsonObject step, Dictionary<string, Frames> sockets)
    {
        var action = step["ws"]!.GetValue<string>();
        if (action == "connect")
        {
            var client = host.Server.CreateWebSocketClient();
            client.ConfigureRequest = request =>
            {
                foreach (var header in step["headers"]?.AsObject() ?? [])
                    request.Headers[header.Key] = header.Value!.GetValue<string>();
            };
            var rejected = step["expect"]?.GetValue<string>() == "rejected";
            try
            {
                var socket = await client.ConnectAsync(new Uri("ws://localhost" + step["path"]!.GetValue<string>()), CancellationToken.None);
                if (rejected) return ["websocket handshake was accepted, wanted rejected"];
                sockets[step["name"]!.GetValue<string>()] = new Frames(socket);
                return [];
            }
            catch (Exception) when (rejected)
            {
                return [];
            }
            catch (Exception error)
            {
                return [$"websocket handshake was refused: {error.Message}"];
            }
        }

        var frames = sockets[step["name"]!.GetValue<string>()];
        var timeout = TimeSpan.FromMilliseconds(step["timeout_ms"]?.GetValue<int>() ?? 8000);
        if (action == "send")
        {
            await frames.Send(step["json"]!.ToJsonString());
            return [];
        }
        if (action == "expect_close")
        {
            var (kind, value) = await frames.Next(timeout);
            var wanted = step["code"]!.GetValue<int>().ToString();
            return kind == "close" && value == wanted ? [] : [$"wanted close {wanted}, got {kind} {value}"];
        }

        var failures = new List<string>();
        var tag = step["tag"]?.GetValue<string>();
        while (true)
        {
            var (kind, value) = await frames.Next(timeout);
            if (kind == "timeout") return [.. failures, "timed out waiting for a frame"];
            if (kind != "text") return [.. failures, $"socket ended with {kind} {value}"];
            if (tag is not null && !value.StartsWith(tag, StringComparison.Ordinal))
            {
                failures = [$"frame tag '{value[..Math.Min(1, value.Length)]}' != '{tag}'"];
                continue;
            }
            if (step["raw"]?.GetValue<bool>() == true) return failures;
            var body = JsonNode.Parse(tag is null ? value : value[tag.Length..]);
            failures = ContractMatchers.ExpectationFailures(step["expect"]?.AsObject() ?? [], body, host.Root);
            if (failures.Count == 0 || step["skip_until_match"]?.GetValue<bool>() != true) return failures;
        }
    }

    private sealed class Frames : IDisposable
    {
        private readonly WebSocket _socket;
        private readonly Channel<(string Kind, string Value)> _channel = Channel.CreateUnbounded<(string, string)>();
        private readonly CancellationTokenSource _cts = new();

        public Frames(WebSocket socket)
        {
            _socket = socket;
            _ = Task.Run(Pump);
        }

        private async Task Pump()
        {
            var buffer = new byte[16 * 1024];
            try
            {
                while (true)
                {
                    var text = new StringBuilder();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await _socket.ReceiveAsync(buffer, _cts.Token);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            await _channel.Writer.WriteAsync(("close", ((int?)result.CloseStatus ?? 0).ToString()));
                            return;
                        }
                        text.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    } while (!result.EndOfMessage);
                    await _channel.Writer.WriteAsync(("text", text.ToString()));
                }
            }
            catch (Exception error)
            {
                await _channel.Writer.WriteAsync(("error", error.Message));
            }
        }

        public Task Send(string text) =>
            _socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);

        public async Task<(string Kind, string Value)> Next(TimeSpan timeout)
        {
            using var cts = new CancellationTokenSource(timeout);
            try { return await _channel.Reader.ReadAsync(cts.Token); }
            catch (OperationCanceledException) { return ("timeout", ""); }
        }

        public void Dispose()
        {
            _cts.Cancel();
            _socket.Dispose();
        }
    }
}
