"""Invoice model nested one directory deeper than billing/service.py."""


class Invoice:
    """A single billing invoice."""

    def total(self, lines: list) -> float:
        """Sum the amounts of all invoice lines."""
        return sum(line["amount"] for line in lines)


def format_invoice_id(number: int) -> str:
    """Render a zero-padded invoice id string."""
    return f"INV-{number:06d}"
