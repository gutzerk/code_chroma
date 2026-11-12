"""Wire models for an agent's question: the `ask_user` input and the result handed back."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

QuestionState = Literal["open", "answered", "skipped", "chat"]

# Outcome texts typed to the agent; bridge_contract/question_outcomes.json pins them to C#.
SKIPPED = "skipped by the user, decide yourself"
DIAGRAM_REQUEST = (
    "the user wants a diagram for each option: draw them with draw_option_diagram, "
    "then call ask_user again with the same session_id and question"
)
# Typed to the agent (and read back by ask_user_result) when the user presses "Chat about it".
CHAT = (
    "the user wants to talk this question through in chat before deciding: discuss it with them, "
    "and call ask_user again with the same session_id once a decision is needed"
)


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
