# `adapters/mcp`

Thin local MCP transport. Maps requests to `DocumentSession` commands and
nothing else.

It never writes the file, synthesises UI input, or holds a parallel document
model — the same rule that keeps 33 Switchboard MCP tools consistent
(SWITCHBOARD-KERNEL.md §4). Filled by the live-agent deliverable.
