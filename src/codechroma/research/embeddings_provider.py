"""One embeddings call, wrapped -- mirrors llm_provider.py; no SDK dep, just an HTTP call."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Protocol

from codechroma.config import load_env_once, settings

_VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings"


class EmbeddingsProvider(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class EmbeddingsProviderError(Exception):
    """Raised on any provider failure -- callers treat the whole embedding step as skipped."""


class VoyageEmbeddingsProvider:
    """Calls Voyage AI's embeddings REST endpoint directly; one vector per input, same order."""

    def __init__(self, api_key: str, model: str, timeout: float) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    def embed(self, texts: list[str]) -> list[list[float]]:
        body = json.dumps({"input": texts, "model": self._model}).encode()
        request = urllib.request.Request(
            _VOYAGE_EMBEDDINGS_URL,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                payload = json.loads(response.read())
        except (urllib.error.URLError, ValueError) as exc:
            raise EmbeddingsProviderError(str(exc)) from exc
        data = payload.get("data", [])
        return [entry["embedding"] for entry in data]


def embeddings_provider_from_env() -> EmbeddingsProvider | None:
    """A VoyageEmbeddingsProvider if VOYAGE_API_KEY is set, else None -- the degrade signal."""
    load_env_once()
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        return None
    config = settings.embeddings_provider
    return VoyageEmbeddingsProvider(api_key, config.model, config.request_timeout_seconds)
