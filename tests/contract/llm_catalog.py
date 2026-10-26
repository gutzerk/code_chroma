"""Dumps the code-defined catalogs (LLM call sites, adapters, diagram styles, providers) for C#.

`python -m tests.contract.llm_catalog` rewrites tests/fixtures/bridge_contract/llm_catalog.json,
which `CodeChroma.Bridge` embeds; `test_llm_catalog_snapshot.py` fails when the file drifts.
"""

from __future__ import annotations

import json
from pathlib import Path

from codechroma.bridge.context_providers import CONTEXT_PROVIDERS
from codechroma.bridge.overlays import OVERLAY_PROVIDERS
from codechroma.bridge.review import REVIEW_AGENT_FACTORIES
from codechroma.config import settings
from codechroma.diagrams.styles import STYLES
from codechroma.llm.call_sites import CALL_SITES, FEATURES, GROUPS, HIDDEN_GROUPS
from codechroma.llm.cli_adapters import CLI_ADAPTERS
from codechroma.llm.providers_store import KINDS, TRANSPORTS

CATALOG_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "bridge_contract" / "llm_catalog.json"
)


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
        "features": [
            {
                "id": feature.id,
                "label": feature.label,
                "description": feature.description,
                "needs": feature.needs,
                "members": list(feature.members),
            }
            for feature in FEATURES.values()
        ],
        "adapters": list(CLI_ADAPTERS),
        "transports": list(TRANSPORTS),
        "kinds": list(KINDS),
        "diagram_styles": [
            {
                "id": style.id,
                "label": style.label,
                "description": style.description,
                "overrides": style.overrides,
            }
            for style in STYLES.values()
        ],
        "context_providers": sorted(CONTEXT_PROVIDERS),
        "overlay_providers": sorted(OVERLAY_PROVIDERS),
        "review_agents": sorted(REVIEW_AGENT_FACTORIES),
        "custom_diagrams": {
            "type_id_pattern": settings.custom_diagrams.type_id_pattern,
            "max_types": settings.custom_diagrams.max_types,
        },
    }


if __name__ == "__main__":
    CATALOG_PATH.write_text(json.dumps(build_catalog(), indent=2) + "\n", encoding="utf-8")
