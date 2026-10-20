using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Workflows;

/// <summary>Stage 3-4 of the runner: the run agent and step agents behind message(), the per-run MCP, and the redo path.</summary>
public sealed partial class WorkflowRunner
{
    public const string McpServerName = "codechroma-run";
    private const int OutputTailChars = 1500;
    private static readonly string[] ReadOnlyTools = ["Read", "Grep", "Glob"];

    /// <summary>Routes a question to the run agent ("run") or to one step's agent (step id or slug); it never changes the run state.</summary>
    public async Task<MessageReply> Message(string runId, string target, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) throw new BridgeException(400, "text is required");
        var chat = _chat ?? throw new BridgeException(409, "no run agent is configured");
        string key, prompt, worktree, token;
        string? stepId, session = null;
        RunMessage user;
        lock (_lock)
        {
            var h = Require(runId);
            stepId = target is "run" or "" ? null : ResolveStep(h, target);
            key = runId + ":" + (stepId ?? "run");
            if (chat.GetState(key).State == "generating") throw new BridgeException(409, "that agent is still answering");
            user = AddMessage(h, stepId ?? "run", "user", text.Trim());
            prompt = stepId is null ? RunAgentPrompt(h, text) : StepAgentPrompt(h, stepId, text);
            if (stepId is not null) session = Record(h, stepId).SessionId;
            worktree = h.Worktree;
            token = h.McpToken;
            Persist(h, "run.message");
        }
        var extra = new List<string> { "--tools", string.Join(',', ReadOnlyTools) };
        if (stepId is null && _mcpUrl?.Invoke(runId) is { } url)
            extra.AddRange(["--strict-mcp-config", "--mcp-config", McpConfig(url, token)]);
        if (session is not null) extra.AddRange(["--resume", session]);

        string reply;
        try
        {
            reply = await AskAgent(chat, key, worktree, prompt, extra);
        }
        catch (BridgeException error)
        {
            lock (_lock)
            {
                var h = Require(runId);
                AddMessage(h, stepId ?? "run", "system", "The agent could not answer: " + error.Message);
                Persist(h, "run.message");
            }
            throw;
        }
        lock (_lock)
        {
            var h = Require(runId);
            var answer = AddMessage(h, stepId ?? "run", "agent", reply.Length > 0 ? reply : "(no answer)");
            Persist(h, "run.message");
            return new MessageReply { Reply = answer.Text, MessageId = answer.Id };
        }
    }

    private static async Task<string> AskAgent(SkillAgent chat, string key, string cwd, string prompt, IReadOnlyList<string> extra)
    {
        WriteMarker(Marker("chat", key));
        var done = new TaskCompletionSource<JobState>(TaskCreationOptions.RunContinuationsAsynchronously);
        var lines = new List<string>();
        var started = await chat.Start(
            key, cwd,
            (_, state) => { if (state.State != "generating") done.TrySetResult(state); return Task.CompletedTask; },
            (_, batch) => { lock (lines) lines.AddRange(batch); return Task.CompletedTask; },
            prompt, null, new RunOptions(extra) { Bare = false });
        if (started.State != "generating") done.TrySetResult(started);
        var result = await done.Task;
        if (result.State != "idle") throw new BridgeException(502, result.Error ?? "the agent failed");
        lock (lines) return string.Join("\n", lines).Trim();
    }

    private static string McpConfig(string url, string token) => new JsonObject
    {
        ["mcpServers"] = new JsonObject
        {
            [McpServerName] = new JsonObject
            {
                ["type"] = "http", ["url"] = url,
                ["headers"] = new JsonObject { ["Authorization"] = "Bearer " + token },
            },
        },
    }.ToJsonString();

    private static string ResolveStep(Handle h, string target)
    {
        var wanted = target.TrimStart('@');
        var step = h.Def.Steps.Find(s => s.Id == wanted) ?? h.Def.Steps.Find(s => s.Slug == wanted);
        return step?.Id ?? throw new BridgeException(404, $"unknown step: {target}");
    }

    private static RunMessage AddMessage(Handle h, string target, string role, string text)
    {
        var message = new RunMessage { Id = "m-" + Guid.NewGuid().ToString("N")[..8], Target = target, Role = role, Text = text, At = DateTime.UtcNow.ToString("o") };
        h.Run.Messages.Add(message);
        return message;
    }

    private static string Tail(string text) => text.Length <= OutputTailChars ? text : "..." + text[^OutputTailChars..];

    private static string StepDigest(Handle h)
    {
        var sb = new StringBuilder();
        foreach (var step in h.Def.Steps)
        {
            var record = h.Run.Steps.Find(s => s.StepId == step.Id);
            sb.Append($"- {step.Id} (@{step.Slug}, {step.Kind}) status={record?.Status ?? "pending"} attempt={record?.Attempt ?? h.Run.Attempt}");
            if (record?.DiffStat is { } diff) sb.Append($" diff: {diff}");
            sb.AppendLine();
            if (record is { Output.Length: > 0 }) sb.AppendLine("  output tail: " + Tail(record.Output).Replace("\n", "\n    "));
        }
        return sb.ToString();
    }

    private static string RunAgentPrompt(Handle h, string text)
    {
        var history = string.Join("\n", h.Run.Messages.Where(m => m.Target == "run").TakeLast(7).SkipLast(1).Select(m => $"{m.Role}: {m.Text}"));
        return $"""
            You are the run agent of the workflow "{h.Def.Name}" (run {h.Run.Id}). The run is {h.Run.State}, at step {h.Run.CurrentStepId ?? "none"}, attempt {h.Run.Attempt}.
            You can read the working tree in the current directory but you cannot edit anything, and answering never pauses or changes the run.
            Your only actions are the MCP tools {McpServerName}: pause, stop and propose_redo. propose_redo only suggests the earliest step to redo; the user confirms it. Use pause or stop only when the user asks for it.
            Steps:
            {StepDigest(h)}
            {(history.Length > 0 ? "Recent conversation:\n" + history + "\n" : "")}
            User question: {text}
            """;
    }

    private static string StepAgentPrompt(Handle h, string stepId, string text)
    {
        var step = h.Def.Steps.Find(s => s.Id == stepId)!;
        var record = h.Run.Steps.Find(s => s.StepId == stepId);
        return $"""
            You are the agent of step "{step.Slug}" in the workflow "{h.Def.Name}". Your task was: {step.Prompt}
            Its status is {record?.Status ?? "pending"}. Your output so far: {Tail(record?.Output ?? "")}
            Answer the question below from what you did. You can read the working tree but you cannot change anything, and you must not continue or redo the task.

            Question: {text}
            """;
    }

    /// <summary>One JSON-RPC request of the per-run MCP endpoint; null for a notification.</summary>
    public async Task<JsonObject?> HandleMcp(string runId, string? bearer, JsonObject request)
    {
        string token;
        lock (_lock) token = Require(runId).McpToken;
        if (bearer != "Bearer " + token) throw new BridgeException(401, "bad run token");
        var id = request["id"]?.DeepClone();
        var method = request["method"]?.GetValue<string>() ?? "";
        if (id is null) return null;
        JsonObject result;
        switch (method)
        {
            case "initialize":
                result = new JsonObject
                {
                    ["protocolVersion"] = request["params"]?["protocolVersion"]?.GetValue<string>() ?? "2025-03-26",
                    ["capabilities"] = new JsonObject { ["tools"] = new JsonObject() },
                    ["serverInfo"] = new JsonObject { ["name"] = McpServerName, ["version"] = "1" },
                };
                break;
            case "tools/list":
                result = new JsonObject { ["tools"] = McpTools() };
                break;
            case "tools/call":
                result = await CallTool(runId, request["params"]?["name"]?.GetValue<string>() ?? "", request["params"]?["arguments"] as JsonObject ?? []);
                break;
            case "ping":
                result = new JsonObject();
                break;
            default:
                return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JsonObject { ["code"] = -32601, ["message"] = "method not found" } };
        }
        return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };
    }

    private static JsonArray McpTools() => new(
        Tool("pause", "Pause the run after the current tool call.", new JsonObject()),
        Tool("stop", "Stop the run. mode is now (default) or afterStep.", new JsonObject { ["mode"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("now", "afterStep") } }),
        Tool("propose_redo", "Suggest redoing from a step; the user confirms. Never redoes anything itself.",
            new JsonObject { ["from"] = new JsonObject { ["type"] = "string" }, ["note"] = new JsonObject { ["type"] = "string" } }, "from"));

    private static JsonObject Tool(string name, string description, JsonObject properties, params string[] required) => new()
    {
        ["name"] = name,
        ["description"] = description,
        ["inputSchema"] = new JsonObject { ["type"] = "object", ["properties"] = properties, ["required"] = new JsonArray(required.Select(r => (JsonNode?)r).ToArray()) },
    };

    private async Task<JsonObject> CallTool(string runId, string name, JsonObject args)
    {
        try
        {
            string text;
            switch (name)
            {
                case "pause":
                    Pause(runId);
                    text = "Run paused.";
                    break;
                case "stop":
                    var mode = args["mode"]?.GetValue<string>() ?? "now";
                    await Stop(runId, mode);
                    text = mode == "afterStep" ? "The run will stop after this step." : "Run stopped.";
                    break;
                case "propose_redo":
                    ProposeRedo(runId, args["from"]?.GetValue<string>() ?? "", args["note"]?.GetValue<string>());
                    text = "Redo proposed; the user decides.";
                    break;
                default:
                    return ToolResult($"unknown tool: {name}", true);
            }
            return ToolResult(text, false);
        }
        catch (BridgeException error)
        {
            return ToolResult(error.Message, true);
        }
    }

    private static JsonObject ToolResult(string text, bool isError) => new()
    {
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }),
        ["isError"] = isError,
    };

    private static RedoCard BuildCard(Handle h, int index, string note)
    {
        var reruns = h.Def.Steps.Skip(index).Select(s => s.Id).ToList();
        return new RedoCard
        {
            Reruns = reruns,
            Keeps = h.Def.Steps.Take(index).Select(s => s.Id).ToList(),
            SetsAside = reruns.Where(id => h.Run.Steps.Find(r => r.StepId == id) is { Status: not "pending" }).ToList(),
            Note = note,
        };
    }

    /// <summary>Records the run agent's suggestion on the run; nothing is redone until redo() is called.</summary>
    public Run ProposeRedo(string runId, string from, string? note)
    {
        lock (_lock)
        {
            var h = Require(runId);
            var index = IndexOf(h, from);
            if (index < 0) throw new BridgeException(404, $"unknown step: {from}");
            h.Run.RedoProposal = new RedoProposal { From = from, Card = BuildCard(h, index, note ?? "") };
            AddMessage(h, "run", "system", $"Redo from {from} proposed.");
            Persist(h, "run.redo.proposed");
            return Clone(h.Run);
        }
    }

    public Run CancelRedo(string runId) => Command(runId, "run.step", h =>
    {
        h.Run.RedoProposal = null;
        AddMessage(h, "run", "system", "Redo cancelled.");
    });

    /// <summary>Sets the current attempt aside on a branch, resets the worktree to the step's checkpoint and starts the next attempt there.</summary>
    public async Task<Run> Redo(string runId, string from, string? note, StepEdit? edit)
    {
        Handle h;
        lock (_lock)
        {
            h = Require(runId);
            if (!RunStateMachine.IsLegal(h.Run.State, RunCommand.Redo)) throw Illegal(h, "redo");
        }
        await h.Loop;
        lock (_lock)
        {
            if (!RunStateMachine.IsLegal(h.Run.State, RunCommand.Redo)) throw Illegal(h, "redo");
            var index = IndexOf(h, from);
            if (index < 0) throw new BridgeException(404, $"unknown step: {from}");
            if (h.Def.Steps[index].Kind != "agent") throw new BridgeException(409, "only an agent step can be redone");
            var checkpoint = h.Run.Steps.Find(s => s.StepId == from)?.CheckpointRef
                ?? throw new BridgeException(409, "that step never started, so it has no checkpoint; resume the run instead");
            var attempt = h.Run.Attempt;
            var branch = KeepAttempt(h, $"{h.Run.Id}/attempt-{attempt}", checkpoint);

            h.Run.Attempts.RemoveAll(a => a.N == attempt + 1);
            var current = h.Run.Attempts.Find(a => a.N == attempt);
            if (current is null) h.Run.Attempts.Add(current = new RunAttempt { N = attempt });
            current.Branch = branch;
            current.Steps = h.Run.Steps.Select(CloneStep).ToList();
            h.Run.Attempts.Add(new RunAttempt { N = attempt + 1, Branch = "workflow/" + h.Run.Id });
            h.Run.Attempt = attempt + 1;

            var trimmed = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
            var fresh = new List<StepRecord>();
            for (var i = 0; i < h.Def.Steps.Count; i++)
            {
                var id = h.Def.Steps[i].Id;
                var old = h.Run.Steps.Find(s => s.StepId == id);
                if (i < index && old is not null)
                {
                    old.FromAttempt ??= old.Attempt;
                    old.Attempt = attempt + 1;
                    fresh.Add(old);
                }
                else
                {
                    fresh.Add(new StepRecord { StepId = id, Attempt = attempt + 1, Output = i == index && trimmed is not null ? $"--- redo note: {trimmed} ---" : "" });
                }
            }
            h.Run.Steps = fresh;
            ApplyStepEdit(h, index, edit);

            Transition(h, RunCommand.Redo);
            h.Run.CurrentStepId = from;
            h.Run.StopAfter = null;
            h.Run.RedoProposal = null;
            h.Bypass = from;
            h.Rerun = trimmed is null ? null : from;
            h.Note = trimmed;
            AddMessage(h, "run", "system", $"Attempt {attempt + 1} started from {from}; attempt {attempt} is kept on {branch}.");
            Persist(h, "run.redo.started");
            Drive(h, index);
            return Clone(h.Run);
        }
    }

    private void ApplyStepEdit(Handle h, int index, StepEdit? edit)
    {
        if (edit is null || string.IsNullOrWhiteSpace(edit.Prompt)) return;
        var step = h.Def.Steps[index];
        step.Prompt = edit.Prompt;
        if (edit.SaveToWorkflow)
        {
            h.Run.PromptOverrides.Remove(step.Id);
            Store.SaveWorkflow(h.Def);
        }
        else
        {
            h.Run.PromptOverrides[step.Id] = edit.Prompt;
        }
    }

    private string KeepAttempt(Handle h, string branch, string checkpoint)
    {
        try
        {
            return WorktreeOps.SetAside(_repoRoot, h.Worktree, branch, checkpoint, $"workflow attempt {h.Run.Attempt} set aside");
        }
        catch (WorktreeException error)
        {
            throw new BridgeException(500, error.Message);
        }
    }

    private static StepRecord CloneStep(StepRecord s) => new()
    {
        StepId = s.StepId, Attempt = s.Attempt, Status = s.Status, Output = s.Output, DiffStat = s.DiffStat,
        CheckpointRef = s.CheckpointRef, SessionId = s.SessionId, FromAttempt = s.FromAttempt,
    };
}
