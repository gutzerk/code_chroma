"""In-memory waiters for open questions: one asyncio future per question id."""

from __future__ import annotations

import asyncio

from codechroma.questions.models import QuestionResult


class QuestionBroker:
    """Holds the live waiter and the settled result of each question, keyed by question id."""

    def __init__(self) -> None:
        self._futures: dict[str, asyncio.Future[QuestionResult]] = {}
        self._results: dict[str, QuestionResult] = {}

    def open(self, question_id: str) -> None:
        """Registers a waiter on the running loop; call from the loop that will await it."""
        loop = asyncio.get_running_loop()
        self._futures[question_id] = loop.create_future()

    def is_waiting(self, question_id: str) -> bool:
        """Whether a live, unsettled waiter exists (false after a restart or once settled)."""
        future = self._futures.get(question_id)
        return future is not None and not future.done()

    def answer(self, question_id: str, answer: str, option_id: str | None = None) -> bool:
        """Settles with an answer; returns whether a live waiter was woken."""
        return self._settle(question_id, QuestionResult(answer=answer, option_id=option_id))

    def skip(self, question_id: str) -> bool:
        """Settles as skipped; returns whether a live waiter was woken."""
        return self._settle(question_id, QuestionResult(skipped=True))

    def request_diagram(self, question_id: str) -> bool:
        """Wakes the blocked `ask_user` with `needs: diagram`; true if a waiter was woken."""
        return self._settle(
            question_id, QuestionResult(needs="diagram", question_id=question_id)
        )

    def lookup(self, question_id: str) -> QuestionResult:
        """`ask_user_result`: the settled result, else a pending marker carrying the id."""
        return self._results.get(question_id) or QuestionResult(
            pending=True, question_id=question_id
        )

    async def wait(self, question_id: str, timeout: float) -> QuestionResult:
        """Blocks until settled; on timeout returns pending and keeps the waiter registered."""
        future = self._futures.get(question_id)
        if future is None:
            return self.lookup(question_id)
        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout)
        except TimeoutError:
            return self.lookup(question_id)

    def forget(self, question_id: str) -> None:
        """Drops a settled result (the question was reopened)."""
        self._results.pop(question_id, None)

    def close(self, question_id: str) -> None:
        """Drops a waiter without settling it (the agent went away)."""
        future = self._futures.pop(question_id, None)
        if future is not None and not future.done():
            future.cancel()

    def _settle(self, question_id: str, result: QuestionResult) -> bool:
        self._results[question_id] = result
        future = self._futures.pop(question_id, None)
        if future is None or future.done():
            return False
        future.get_loop().call_soon_threadsafe(_set_if_pending, future, result)
        return True


def _set_if_pending(future: asyncio.Future[QuestionResult], result: QuestionResult) -> None:
    if not future.done():
        future.set_result(result)
