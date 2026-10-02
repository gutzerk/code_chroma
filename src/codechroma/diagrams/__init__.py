"""User-defined custom diagram types: a cross-project library plus a render-style registry.

`styles.py` is the fixed set of ways a definition can be drawn (one entry, `boxes-arrows`, for v1).
`library.py` is where a saved definition lives on disk, in the user's home directory rather than the
repo -- a diagram *type* ("data flow, grouped by layer") is reusable across projects, unlike the
diagram itself. `registry.py` is the declarative `DiagramTypeDefinition` every type (built-in or
custom) resolves to; the per-repo generated artifact path lives on its `artifact` field.
"""
