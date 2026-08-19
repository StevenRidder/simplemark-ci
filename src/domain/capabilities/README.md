# `domain/capabilities`

The capability lattice: owner, editor, commenter, reader.

Only owner and editor may write. A grant is strictly narrower than the
granter, checked at issue and again on every call (MCP-SERVER.md §3.1).
