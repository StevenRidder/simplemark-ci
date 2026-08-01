# Architecture decision register

Accepted decisions are binding on implementation plans and code. If a plan conflicts with an
accepted ADR, update the plan before executing it; do not silently choose the easier source.

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-single-product-modular-architecture.md) | Accepted | One product repo and release, with enforced internal modules; no monorepo and no monolithic application core |
| [0002](0002-local-document-session-before-crdt.md) | Accepted | The local POC uses `DocumentSession`; later clients require an authority decision, not an assumed CRDT |
| [0003](0003-rendered-block-frame.md) | Accepted | Rendered blocks keep a shared frame; their controls fade in on hover or focus |
