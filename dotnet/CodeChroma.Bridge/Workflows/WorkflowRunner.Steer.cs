using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Workflows;

/// <summary>Stage 3-4 of the runner: talking to a step agent behind message(), the per-run MCP, and the redo path.</summary>
public sealed partial class WorkflowRunner
{
    public const string McpServerName = "codechroma-run";
    private const int OutputTailChars = 1500;
    private static readonly string[] ReadOnlyTools = ["Read", "Grep", "Glob"];

    /// <summary>Sends a message straight to a step's agent by resuming its session; "run" or "" picks the step waiting for you, else the last agent step that has a session.</summary>
    public async Task<MessageReply> Message(string runId, string target, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) throw new BridgeException(400, "text is required");
        var chat = _chat ?? throw new BridgeException(409, "no agent is configured to answer");
        string key, worktree, token;
        IReadOnlyList<string> args;
        lock (_lock)
        {
            var h = Require(runId);
            var step = ChatStep(h, target, out var record);
            var session = record.SessionId ?? throw new BridgeException(409, $"{step.Slug} has no agent session to talk to");
            CliResolution cli;
            try
            {
                cli = chat.ResolveCli(step.Provider, step.Model);
            }
            catch (CliLookupException error)
            {
                throw new BridgeException(409, error.Message);
            }
            var resume = CliAdapters.ResumeArgs(cli.AdapterKey, session, false);
            if (resume.Count == 0) throw new BridgeException(409, $"the {cli.AdapterKey} CLI cannot resume a step's session");
            key = runId + ":run";
            if (chat.GetState(key).State == "generating" || !_chatBusy.Add(key)) throw new BridgeException(409, "that agent is still answering");
            try
            {
                var list = new List<string>(resume);
                if (cli.AdapterKey == "claude" && _mcpUrl?.Invoke(runId) is { } url) list.AddRange(["--mcp-config", McpConfig(url, h.McpToken)]);
                args = list;
                AddMessage(h, "run", "user", text.Trim());
                worktree = h.Worktree;
                token = h.McpToken;
                Persist(h, "run.message");
            }
            catch
            {
                _chatBusy.Remove(key);
                throw;
            }
        }
        try
        {
            string reply;
            try
            {
                reply = await AskAgent(chat, key, worktree, text.Trim(), args);
            }
            catch (BridgeException error)
            {
                lock (_lock)
                {
                    var h = Require(runId);
                    AddMessage(h, "run", "system", "The agent could not answer: " + error.Message);
                    Persist(h, "run.message");
                }
                throw;
            }
            lock (_lock)
            {
                var h = Require(runId);
                var answer = AddMessage(h, "run", "agent", reply.Length > 0 ? reply : "(no answer)");
                Persist(h, "run.message");
                return new MessageReply { Reply = answer.Text, MessageId = answer.Id };
            }
        }
        finally
        {
            lock (_lock) _chatBusy.Remove(key);
        }
    }

    /// <summary>The agent step a chat message goes to: the one named by id or slug, else the one waiting on the user, else the last with a session; a still-running step cannot take input.</summary>
    private static WorkflowStep ChatStep(Handle h, string target, out StepRecord record)
    {
        WorkflowStep? step = null;
        if (target is not ("run" or "")) step = h.Def.Steps.Find(s => s.Id == target || s.Slug == target);
        if (step is null && target is not ("run" or "")) throw new BridgeException(404, $"unknown step {target}");
        step ??= h.Def.Steps.Find(s => s.Kind == "agent" && h.Run.Steps.Find(r => r.StepId == s.Id) is { Status: "needs_you", Report: { Status: not "done" } });
        step ??= h.Def.Steps.FindLast(s => s.Kind == "agent" && h.Run.Steps.Find(r => r.StepId == s.Id)?.SessionId is not null);
        if (step is null) throw new BridgeException(409, "no step has an agent session to talk to yet");
        if (step.Kind != "agent") throw new BridgeException(409, $"{step.Slug} is not an agent step");
        record = Record(h, step.Id);
        if (record.Status == "running") throw new BridgeException(409, $"{step.Slug} is still running; message it once it stops or asks you something");
        return step;
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

    private static RunMessage AddMessage(Handle h, string target, string role, string text)
    {
        var message = new RunMessage { Id = "m-" + Guid.NewGuid().ToString("N")[..8], Target = target, Role = role, Text = text, At = DateTime.UtcNow.ToString("o") };
        h.Run.Messages.Add(message);
        return message;
    }

    private static string Tail(string text) => text.Length <= OutputTailChars ? text : "..." + text[^OutputTailChars..];

    /// <summary>One JSON-RPC request of the per-run MCP endpoint; null for a notification.</summary>
    public async Task<JsonObject?> HandleMcp(string runId, string? bearer, JsonObject request)
    {
        string token;
        try
        {
            lock (_lock) token = Require(runId).McpToken;
        }
        catch (BridgeException)
        {
            throw new BridgeException(401, "bad run token");
        }
        if (bearer != "Bearer " + token) throw new BridgeException(401, "bad run token");
        var id = request["id"]?.DeepClone();
        var method = Json.Str(request["method"]) ?? "";
        var parameters = request["params"] as JsonObject;
        if (id is null) return null;
        JsonObject result;
        switch (method)
        {
            case "initialize":
                result = new JsonObject
                {
                    ["protocolVersion"] = Json.Str(parameters?["protocolVersion"]) ?? "2025-03-26",
                    ["capabilities"] = new JsonObject { ["tools"] = new JsonObject() },
                    ["serverInfo"] = new JsonObject { ["name"] = McpServerName, ["version"] = "1" },
                };
                break;
            case "tools/list":
                result = new JsonObject { ["tools"] = McpTools() };
                break;
            case "tools/call":
                result = await CallTool(runId, Json.Str(parameters?["name"]) ?? "", parameters?["arguments"] as JsonObject ?? []);
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
            new JsonObject { ["from"] = new JsonObject { ["type"] = "string" }, ["note"] = new JsonObject { ["type"] = "string" } }, "from"),
        Tool("report_status", "Step agents only: report done, blocked or question (with a one-line note) when the step ends.",
            new JsonObject { ["status"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray(StepReports.Done, StepReports.Blocked, StepReports.Question) }, ["note"] = new JsonObject { ["type"] = "string" } }, "status"));

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
                    if (args["mode"] is { } given && Json.Str(given) is null) return ToolResult("mode must be a string", true);
                    var mode = Json.Str(args["mode"]) ?? "now";
                    await Stop(runId, mode);
                    text = mode == "afterStep" ? "The run will stop after this step." : "Run stopped.";
                    break;
                case "propose_redo":
                    ProposeRedo(runId, Json.Str(args["from"]) ?? "", Json.Str(args["note"]));
                    text = "Redo proposed; the user decides.";
                    break;
                case "report_status":
                    ReportStatus(runId, Json.Str(args["status"]), Json.Str(args["note"]));
                    text = "Status recorded.";
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
            return View(h);
        }
    }

    /// <summary>Records the step agent's report on the running step; a blocked or question report parks the step when the agent exits.</summary>
    public void ReportStatus(string runId, string? status, string? note)
    {
        if (status is not (StepReports.Done or StepReports.Blocked or StepReports.Question)) throw new BridgeException(400, "status must be done, blocked or question");
        lock (_lock)
        {
            var h = Require(runId);
            if (h.Run.CurrentStepId is not { } id || Record(h, id) is not { Status: "running" or "paused" or "stopping" } record)
                throw new BridgeException(409, "no step is running");
            record.Report = new StepReport { Status = status, Note = (note ?? "").Trim() };
            Persist(h, "run.step");
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
        return await RerunFrom(h, from, note, edit, RunCommand.Redo, "redo");
    }

    /// <summary>Redo and send back: keep the attempt on a branch, reset to the step's checkpoint and rerun it (see <see cref="PlanRedo"/>).</summary>
    private async Task<Run> RerunFrom(Handle h, string from, string? note, StepEdit? edit, RunCommand command, string verb)
    {
        int index, attempt;
        string checkpoint;
        lock (_lock)
        {
            if (h.Busy) throw new BridgeException(409, "the run is already being redone");
            if (!RunStateMachine.IsLegal(h.Run.State, command)) throw Illegal(h, verb);
            index = IndexOf(h, from);
            if (index < 0) throw new BridgeException(404, $"unknown step: {from}");
            if (h.Def.Steps[index].Kind != "agent") throw new BridgeException(409, "only an agent step can be redone");
            checkpoint = h.Run.Steps.Find(s => s.StepId == from)?.CheckpointRef
                ?? throw new BridgeException(409, "that step never started, so it has no checkpoint; resume the run instead");
            attempt = h.Run.Attempt;
            h.Busy = true;
        }
        // The git work (commit, branch, reset) runs outside the runner-wide lock; Busy makes every state change wait meanwhile.
        string branch;
        try
        {
            branch = KeepAttempt(h, $"{h.Run.Id}/attempt-{attempt}", checkpoint);
        }
        catch
        {
            h.Busy = false;
            throw;
        }
        lock (_lock)
        {
            h.Busy = false;
            h.Run.Attempts.RemoveAll(a => a.N == attempt + 1);
            var current = h.Run.Attempts.Find(a => a.N == attempt);
            if (current is null) h.Run.Attempts.Add(current = new RunAttempt { N = attempt });
            current.Branch = branch;
            current.Steps = h.Run.Steps.Select(CloneStep).ToList();
            h.Run.Attempts.Add(new RunAttempt { N = attempt + 1, Branch = "workflow/" + h.Run.Id });
            h.Run.Attempt = attempt + 1;

            var trimmed = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
            var label = command == RunCommand.SendBack ? "sent back" : "redo note";
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
                    fresh.Add(new StepRecord { StepId = id, Attempt = attempt + 1, Output = i == index && trimmed is not null ? $"--- {label}: {trimmed} ---" : "" });
                }
            }
            h.Run.Steps = fresh;
            ApplyStepEdit(h, index, edit);

            Transition(h, command);
            h.Run.CurrentStepId = from;
            h.Run.StopAfter = null;
            h.Run.RedoProposal = null;
            h.Bypass = from;
            h.Redo = from;
            h.Note = trimmed;
            var lead = command == RunCommand.SendBack ? $"Sent back to {from}: attempt {attempt + 1}" : $"Attempt {attempt + 1}";
            AddMessage(h, "run", "system", $"{lead} started from {from}; attempt {attempt} is kept on {branch}.");
            Persist(h, "run.redo.started");
            Drive(h, index);
            return View(h);
        }
    }

    /// <summary>A rerun forks the nearest earlier session that never saw the rejected work (a continue step: its own source), else starts fresh in the step's mode.</summary>
    private static Launch PlanRedo(Handle h, WorkflowStep step, string adapter)
    {
        if (CliAdapters.CanResume(adapter) && !StepAgents.IsContinue(step.Agent))
        {
            for (var i = IndexOf(h, step.Id) - 1; i >= 0; i--)
            {
                var earlier = h.Def.Steps[i];
                if (earlier.Kind != "agent" || earlier.Provider != step.Provider) continue;
                if (Record(h, earlier.Id) is { Status: not "skipped", SessionId: { } earlierSession })
                    return Launch.Fork(adapter, earlierSession, earlier.Id);
            }
        }
        return PlanLaunch(h, step, false, null, adapter);
    }

    private static string RedoPrompt(string task, string? note) =>
        note is null ? task : $"Reviewer feedback on an earlier attempt at this step, which was rejected and undone: {note}\n\nAddress it. The task of this step:\n{task}";

    private void ApplyStepEdit(Handle h, int index, StepEdit? edit)
    {
        if (edit is null || string.IsNullOrWhiteSpace(edit.Prompt)) return;
        var step = h.Def.Steps[index];
        step.Prompt = edit.Prompt;
        if (edit.SaveToWorkflow)
        {
            h.Run.PromptOverrides.Remove(step.Id);
            // The in-memory definition carries this run's temporary overrides of other steps; save the stored one with only this step changed.
            var stored = Store.GetWorkflow(h.Def.Id) ?? throw new BridgeException(409, $"the workflow {h.Def.Id} no longer exists");
            if (stored.Steps.Find(s => s.Id == step.Id) is { } storedStep) storedStep.Prompt = edit.Prompt;
            Store.SaveWorkflow(stored);
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
        CheckpointRef = s.CheckpointRef, SessionId = s.SessionId, FromAttempt = s.FromAttempt, Usage = s.Usage, ResumedFrom = s.ResumedFrom, Report = s.Report,
    };
}
