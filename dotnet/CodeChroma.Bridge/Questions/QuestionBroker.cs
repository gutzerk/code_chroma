namespace CodeChroma.Bridge.Questions;

/// <summary>In-memory waiters for open questions: one TaskCompletionSource per question id plus the settled-result map.</summary>
public sealed class QuestionBroker
{
    private readonly object _gate = new();
    private readonly Dictionary<string, TaskCompletionSource<QuestionResult>> _futures = [];
    private readonly Dictionary<string, QuestionResult> _results = [];

    public void Open(string questionId)
    {
        lock (_gate) _futures[questionId] = new TaskCompletionSource<QuestionResult>(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    /// <summary>A live, unsettled waiter exists (false after a restart or once settled).</summary>
    public bool IsWaiting(string questionId)
    {
        lock (_gate) return _futures.TryGetValue(questionId, out var future) && !future.Task.IsCompleted;
    }

    public bool Answer(string questionId, string answer, string? optionId = null) => Settle(questionId, new QuestionResult(Answer: answer, OptionId: optionId));

    public bool Skip(string questionId) => Settle(questionId, new QuestionResult(Skipped: true));

    /// <summary>Wakes the blocked ask_user with needs: diagram; true if a waiter was woken.</summary>
    public bool RequestDiagram(string questionId) => Settle(questionId, new QuestionResult(Needs: "diagram", QuestionId: questionId));

    /// <summary>ask_user_result: the settled result, else a pending marker carrying the id.</summary>
    public QuestionResult Lookup(string questionId)
    {
        lock (_gate) return _results.TryGetValue(questionId, out var found) ? found : new QuestionResult(Pending: true, QuestionId: questionId);
    }

    /// <summary>Blocks until settled; on timeout returns pending and keeps the waiter registered.</summary>
    public async Task<QuestionResult> Wait(string questionId, TimeSpan timeout, CancellationToken cancel = default)
    {
        TaskCompletionSource<QuestionResult>? future;
        lock (_gate) _futures.TryGetValue(questionId, out future);
        if (future is null) return Lookup(questionId);
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        var first = await Task.WhenAny(future.Task, Task.Delay(timeout, stop.Token));
        await stop.CancelAsync();
        if (first == future.Task) return await future.Task;
        cancel.ThrowIfCancellationRequested();
        return Lookup(questionId);
    }

    /// <summary>Drops a settled result (the question was reopened).</summary>
    public void Forget(string questionId)
    {
        lock (_gate) _results.Remove(questionId);
    }

    /// <summary>Drops a waiter without settling it (the agent went away).</summary>
    public void Close(string questionId)
    {
        lock (_gate)
        {
            if (_futures.Remove(questionId, out var future)) future.TrySetCanceled();
        }
    }

    private bool Settle(string questionId, QuestionResult result)
    {
        TaskCompletionSource<QuestionResult>? future;
        lock (_gate)
        {
            _results[questionId] = result;
            _futures.Remove(questionId, out future);
        }
        return future is not null && future.TrySetResult(result);
    }
}
