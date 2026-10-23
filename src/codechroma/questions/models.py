"""Wire models for an agent's question: the `ask_user` input and the result handed back."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

QuestionState = Literal["open", "answered", "skipped"]


class QuestionOption(BaseModel):
    """One answer card; `rank` 1 is the agent's recommendation, `diagram_ref` links a diagram."""

    id: str
    title: str
    description: str = ""
    pro: str = ""
    con: str = ""
    rank: int | None = None
    why: str = ""
    diagram_ref: str | None = None


class AskRequest(BaseModel):
    """The `ask_user` tool input."""

    question: str
    session_id: str | None = None
    kind: Literal["choices", "diagram"] = "choices"
    options: list[QuestionOption] = Field(default_factory=list)
    allow_custom: bool = True
    allow_skip: bool = True
    total: int | None = None
    agent_id: str | None = None
    degraded: bool = False


class QuestionResult(BaseModel):
    """What the waiting agent receives: an answer, a skip, or still-pending."""

    answer: str | None = None
    option_id: str | None = None
    skipped: bool = False
    pending: bool = False
    needs: str | None = None
    question_id: str | None = None

    def to_tool_dict(self) -> dict:
        """The JSON the tool returns; pending and needs results carry only what the agent needs."""
        if self.needs:
            return {"needs": self.needs, "question_id": self.question_id}
        if self.pending:
            return {"pending": True, "question_id": self.question_id}
        return {"answer": self.answer, "option_id": self.option_id, "skipped": self.skipped}
