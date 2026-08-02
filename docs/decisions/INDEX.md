# Architecture decision register

Accepted decisions are binding on implementation plans and code. If a plan conflicts with an
accepted ADR, update the plan before executing it; do not silently choose the easier source.

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-single-product-modular-architecture.md) | Accepted | One product repo and release, with enforced internal modules; no monorepo and no monolithic application core |
| [0002](0002-local-document-session-before-crdt.md) | Accepted | An open document uses `DocumentSession`; later direct participants and clients do not imply a CRDT |
| [0003](0003-rendered-block-frame.md) | Accepted | Rendered blocks keep a shared frame; their controls fade in on hover or focus |
| [0004](0004-mcp-as-participant-client.md) | Accepted | MCP is a participant client of the document authority: one tool surface, rebase rather than compare-and-swap, hosted in the app process |
| [0005](0005-rendered-document-before-agent-participation.md) | Accepted | Prove the beautiful living local document before in-app agent participation or collaboration |
