using CodeChroma.Bridge.Questions;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Port of tests/unit/test_question_broker.py.</summary>
public class QuestionBrokerTests
{
    [Fact]
    public async Task Answer_wakes_the_waiter_with_the_answer()
    {
        var broker = new QuestionBroker();
        broker.Open("q1");
        var waiter = broker.Wait("q1", TimeSpan.FromSeconds(5));
        await Task.Yield();

        var woke = broker.Answer("q1", "Modular monolith", "a");
        var result = await waiter;

        Assert.True(woke);
        Assert.Equal(("Modular monolith", "a", false), (result.Answer, result.OptionId, result.Skipped));
    }

    [Fact]
    public async Task Skip_wakes_the_waiter_as_skipped()
    {
        var broker = new QuestionBroker();
        broker.Open("q1");
        var waiter = broker.Wait("q1", TimeSpan.FromSeconds(5));
        await Task.Yield();

        broker.Skip("q1");
        var result = await waiter;

        Assert.True(result.Skipped);
        Assert.Equal("""{"answer":null,"option_id":null,"skipped":true}""", result.ToToolJson().ToJsonString());
    }

    [Fact]
    public async Task Timeout_returns_pending_and_a_later_answer_is_found_by_lookup()
    {
        var broker = new QuestionBroker();
        broker.Open("q1");

        var pending = await broker.Wait("q1", TimeSpan.FromMilliseconds(10));
        var stillWaiting = broker.IsWaiting("q1");
        broker.Answer("q1", "custom");

        Assert.Equal("""{"pending":true,"question_id":"q1"}""", pending.ToToolJson().ToJsonString());
        Assert.True(stillWaiting);
        Assert.Equal("custom", broker.Lookup("q1").Answer);
    }

    [Fact]
    public void Lookup_of_an_unsettled_question_is_pending()
    {
        var result = new QuestionBroker().Lookup("never-opened");

        Assert.Equal("""{"pending":true,"question_id":"never-opened"}""", result.ToToolJson().ToJsonString());
    }

    [Fact]
    public void A_question_without_a_live_waiter_reports_not_waiting()
    {
        var broker = new QuestionBroker();

        var waiting = broker.IsWaiting("restored-from-disk");
        var woke = broker.Answer("restored-from-disk", "x");

        Assert.False(waiting);
        Assert.False(woke);
        Assert.Equal("x", broker.Lookup("restored-from-disk").Answer);
    }

    [Fact]
    public void A_settled_question_is_no_longer_waiting()
    {
        var broker = new QuestionBroker();
        broker.Open("q1");
        broker.Answer("q1", "x");

        Assert.False(broker.IsWaiting("q1"));
    }

    [Fact]
    public async Task Request_diagram_wakes_the_waiter_with_needs()
    {
        var broker = new QuestionBroker();
        broker.Open("q1");
        var waiter = broker.Wait("q1", TimeSpan.FromSeconds(5));

        var woke = broker.RequestDiagram("q1");

        Assert.True(woke);
        Assert.Equal("""{"needs":"diagram","question_id":"q1"}""", (await waiter).ToToolJson().ToJsonString());
    }

    [Fact]
    public async Task Cancelling_the_wait_throws_and_close_drops_the_waiter()
    {
        var broker = new QuestionBroker();
        broker.Open("q1");
        using var cancel = new CancellationTokenSource(20);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => broker.Wait("q1", TimeSpan.FromSeconds(5), cancel.Token));
        broker.Close("q1");

        Assert.False(broker.IsWaiting("q1"));
    }
}
