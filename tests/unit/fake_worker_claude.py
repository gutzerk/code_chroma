"""A stand-in for `asyncio.create_subprocess_exec` at the wiki_general_worker level.

Unlike fake_claude.py (one stream-json feed, shared by the whole `SkillAgent` suite), a worker job
is one full JSON envelope per call, and different jobs (write-c3 vs write-c2 vs resolve-undetermined
vs system-narrative) need different scripted answers -- so this dispatches on the job's own
`--json-schema` argv value's `required` fields instead of assuming one canned response.
"""

from __future__ import annotations

import json


class FakeWorkerProc:
    """Exits immediately with a scripted JSON-envelope stdout, or fails when told to."""

    def __init__(self, *, stdout: bytes, stderr: bytes = b"", returncode: int = 0):
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode

    async def communicate(self):
        return self._stdout, self._stderr

    def kill(self) -> None:
        pass

    async def wait(self):
        return self.returncode


def _schema_required(argv: list[str]) -> list[str]:
    schema = json.loads(argv[argv.index("--json-schema") + 1])
    return schema.get("required", [])


def fake_worker_exec(respond, *, fail_when=None):
    """`respond(prompt, required) -> dict`; `fail_when(...) -> bool` forces one job to fail."""

    async def _exec(*argv, **_kwargs):
        prompt = argv[2]
        required = _schema_required(list(argv))
        if fail_when is not None and fail_when(prompt, required):
            return FakeWorkerProc(stdout=b"", stderr=b"boom", returncode=1)
        data = respond(prompt, required)
        envelope = {"is_error": False, "result": json.dumps(data), "structured_output": data}
        return FakeWorkerProc(stdout=json.dumps(envelope).encode())

    return _exec
