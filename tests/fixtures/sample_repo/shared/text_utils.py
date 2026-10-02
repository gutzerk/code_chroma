"""Small text helpers shared across services."""


def slugify(text: str) -> str:
    """Lowercase and hyphenate text into a URL-safe slug."""
    return text.strip().lower().replace(" ", "-")
