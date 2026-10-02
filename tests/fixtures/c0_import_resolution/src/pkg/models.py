"""Widget model, resolved cross-file via the src-layout package root."""


class Widget:
    """A named widget."""

    def __init__(self, name: str):
        self.name = name


def build(name: str) -> Widget:
    """Constructs a Widget by name."""
    return Widget(name)
