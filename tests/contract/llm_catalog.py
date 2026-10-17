"""Dumps the code-defined LLM catalog (call sites, groups, adapters, transports) for the C# bridge.

`python -m tests.contract.llm_catalog` rewrites tests/fixtures/bridge_contract/llm_catalog.json,
which `CodeChroma.Bridge` embeds; `test_llm_catalog_snapshot.py` fails when the file drifts.
"""

from __future__ import annotations

import json
from pathlib import Path

from codechroma.llm.call_sites import CALL_SITES, GROUPS, HIDDEN_GROUPS
from codechroma.llm.cli_adapters import CLI_ADAPTERS
from codechroma.llm.providers_store import KINDS, TRANSPORTS

CATALOG_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "bridge_contract" / "llm_catalog.json"


def build_catalog() -> dict:
    """The catalog exactly as the C# bridge embeds it."""
    return {
        "call_sites": [
            {
                "id": site.id,
                "label": site.label,
                "capability": site.capability,
                "description": site.description,
            }
            for site in CALL_SITES.values()
        ],
        "groups": [
            {
                "id": group.id,
                "label": group.label,
                "members": list(group.members),
                "hidden": group.id in HIDDEN_GROUPS,
            }
            for group in GROUPS.values()
        ],
        "adapters": list(CLI_ADAPTERS),
        "transports": list(TRANSPORTS),
        "kinds": list(KINDS),
    }


if __name__ == "__main__":
    CATALOG_PATH.write_text(json.dumps(build_catalog(), indent=2) + "\n", encoding="utf-8")
