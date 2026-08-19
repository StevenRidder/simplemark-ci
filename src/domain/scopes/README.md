# `domain/scopes`

Authority-issued opaque scope tokens, each named for one note.

An agent receives a token and returns it. It cannot mint one that resolves,
and the token bytes do not contain the note id. Granting a new scope retires
the previous token (MCP-SERVER.md §6).
