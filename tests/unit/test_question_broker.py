"""QuestionBroker: open/answer/skip/timeout and the not-waiting report."""

from __future__ import annotations

import asyncio

from codechroma.questions.broker import QuestionBroker


def test_answer_wakes_the_waiter_with_the_answer():
    async def scenario():
        broker = QuestionBroker()
        broker.open("q1")
        waiter = asyncio.create_task(broker.wait("q1", timeout=5))
        await asyncio.sleep(0)
        woke = broker.answer("q1", "Modular monolith", "a")
        return woke, await waiter

    woke, result = asyncio.run(scenario())

    assert woke is True
    assert (result.answer, result.option_id, result.skipped) == ("Modular monolith", "a", False)


def test_skip_wakes_the_waiter_as_skipped():
    async def scenario():
        broker = QuestionBroker()
        broker.open("q1")
        waiter = asyncio.create_task(broker.wait("q1", timeout=5))
        await asyncio.sleep(0)
        broker.skip("q1")
        return await waiter

    result = asyncio.run(scenario())

    assert result.skipped is True
    assert result.to_tool_dict() == {"answer": None, "option_id": None, "skipped": True}


def test_timeout_returns_pending_and_a_later_answer_is_found_by_lookup():
    async def scenario():
        broker = QuestionBroker()
        broker.open("q1")
        pending = await broker.wait("q1", timeout=0.01)
        still_waiting = broker.is_waiting("q1")
        broker.answer("q1", "custom")
        return pending, still_waiting, broker.lookup("q1")

    pending, still_waiting, found = asyncio.run(scenario())

    assert pending.to_tool_dict() == {"pending": True, "question_id": "q1"}
    assert still_waiting is True
    assert found.answer == "custom"


def test_lookup_of_an_unsettled_question_is_pending():
    broker = QuestionBroker()

    result = broker.lookup("never-opened")

    assert result.to_tool_dict() == {"pending": True, "question_id": "never-opened"}


def test_question_without_a_live_waiter_reports_not_waiting():
    broker = QuestionBroker()

    waiting = broker.is_waiting("restored-from-disk")
    woke = broker.answer("restored-from-disk", "x")

    assert waiting is False
    assert woke is False
    assert broker.lookup("restored-from-disk").answer == "x"


def test_settled_question_is_no_longer_waiting():
    async def scenario():
        broker = QuestionBroker()
        broker.open("q1")
        broker.answer("q1", "x")
        return broker.is_waiting("q1")

    assert asyncio.run(scenario()) is False
