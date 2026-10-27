"""🔴 Guards the fix for blocking git/gh work running directly inside `async def` route handlers."""

import asyncio
import threading
import time

from httpx import ASGITransport, AsyncClient

from codechroma.bridge.branches.manager import BranchManager, BranchRecord

# Long enough that a blocked loop is unmistakable, short enough to keep the suite quick.
BLOCKING_SECONDS = 1.0
TICK_SECONDS = 0.01


def test_a_slow_git_mutation_leaves_the_event_loop_responsive(bridge, monkeypatch):
    """`POST /branches/new` shells out to git; unoffloaded it would stall every other request."""
    entered = threading.Event()

    def slow_create(_manager, _name=None):
        entered.set()
        time.sleep(BLOCKING_SECONDS)
        return BranchRecord("br_slow", "slow", str(bridge.repo), "now"), False, None

    monkeypatch.setattr(BranchManager, "create_next", slow_create)
    observed: dict[str, object] = {}

    async def _drive():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(TICK_SECONDS)
                ticks += 1

        transport = ASGITransport(app=bridge.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            beat = asyncio.create_task(ticker())
            switch = asyncio.create_task(
                client.post("/branches/new", json={})
            )
            # Only start counting once the blocking call is actually in flight.
            await asyncio.to_thread(entered.wait, 5.0)
            ticks = 0
            health = await client.get("/health")
            response = await switch
            beat.cancel()
        observed["ticks"] = ticks
        observed["health_status"] = health.status_code
        observed["switch_status"] = response.status_code

    asyncio.run(_drive())

    assert observed["switch_status"] == 200
    assert observed["health_status"] == 200
    # A blocked loop cannot tick at all; an offloaded one ticks ~100 times per second.
    assert observed["ticks"] > 10
