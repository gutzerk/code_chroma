using System.Collections.Concurrent;

namespace CodeChroma.Bridge.Questions;

/// <summary>In-memory waiters for open questions: one TaskCompletionSource per question id plus the settled results.</summary>
public sealed class QuestionBroker
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<QuestionResult>> _waiters = new();
    private readonly ConcurrentDictionary<string, QuestionResult> _results = new();

    /// <summary>Registers a waiter for the id (replacing any earlier one).</summary>
    public void Open(string questionId) =>
        _waiters[questionId] = new TaskCompletionSource<QuestionResult>(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Whether a live, unsettled waiter exists (false after a restart or once settled).</summary>
    public bool IsWaiting(string questionId) => _waiters.TryGetValue(questionId, out var waiter) && !waiter.Task.IsCompleted;

    /// <summary>Settles with an answer; returns whether a live waiter was woken.</summary>
    public bool Answer(string questionId, string answer, string? optionId = null) =>
        Settle(questionId, new QuestionResult { Answer = answer, OptionId = optionId });

    /// <summary>Settles as skipped; returns whether a live waiter was woken.</summary>
    public bool Skip(string questionId) => Settle(questionId, new QuestionResult { Skipped = true });

    /// <summary>Wakes the blocked `ask_user` with `needs: diagram`; true if a waiter was woken.</summary>
    public bool RequestDiagram(string questionId) =>
        Settle(questionId, new QuestionResult { Needs = "diagram", QuestionId = questionId });

    /// <summary>`ask_user_result`: the settled result, else a pending marker carrying the id.</summary>
    public QuestionResult Lookup(string questionId) =>
        _results.TryGetValue(questionId, out var found) ? found : new QuestionResult { Pending = true, QuestionId = questionId };

    /// <summary>Blocks until settled; on timeout returns pending and keeps the waiter registered.</summary>
    public async Task<QuestionResult> Wait(string questionId, TimeSpan timeout, CancellationToken cancellation = default)
    {
        if (!_waiters.TryGetValue(questionId, out var waiter)) return Lookup(questionId);
        using var timer = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        var delay = Task.Delay(timeout, timer.Token);
        var finished = await Task.WhenAny(waiter.Task, delay);
        if (finished == waiter.Task)
        {
            await timer.CancelAsync();
            return await waiter.Task;
        }
        cancellation.ThrowIfCancellationRequested();
        return Lookup(questionId);
    }

    /// <summary>Drops a settled result (the question was reopened).</summary>
    public void Forget(string questionId) => _results.TryRemove(questionId, out _);

    /// <summary>Drops a waiter without settling it (the agent went away).</summary>
    public void Close(string questionId)
    {
        if (_waiters.TryRemove(questionId, out var waiter)) waiter.TrySetCanceled();
    }

    private bool Settle(string questionId, QuestionResult result)
    {
        _results[questionId] = result;
        return _waiters.TryRemove(questionId, out var waiter) && waiter.TrySetResult(result);
    }
}
