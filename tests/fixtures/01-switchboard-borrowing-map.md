# What SimpleMark takes from Switchboard

**Four patterns and one file. Not the backend, not the codebase, not the model.**

- **Status:** Draft 1
- **Date:** 2026-08-01
- **Companion to:** [`COLLABORATION.md`](COLLABORATION.md)

<a id="verdict"></a>

## 1. The verdict

**Do not build SimpleMark on Switchboard.** It is a task-completion control plane.

| Take | From | Why |
|---|---|---|
| **The fence** | `domain/execution_liveness.py` (193 lines, pure) | Reliable interruption. [This is the important one](#the-fence). |
| **Exactly-once effects** | `storage/repositories/external_effects.py` | "Insert this diagram" must not insert it twice |
| **Thin adapter** | `application/commands/*` (28) ← `mcp/tools/*` (33) | MCP calls a document service; it never touches files directly |
| **Communication ≠ control** | [ADR-0008](docs/decisions/0008-three-plane-separation.md) | A comment saying "stop" is not proof anything stopped |

### 1.1 Nested structure

1. The fence
   - lifecycle status
   - lease expiry
     * neither alone is sufficient
     * a terminal row with a fresh heartbeat is dead
2. Exactly-once
   1. claimed
   2. issued
   3. verified
3. Thin adapters
   - one set of rules, two transports

> **Six different opinions about whether a thing was still running.**
> That is exactly the bug SimpleMark would ship.

## 2. What NOT to borrow

| Not taken | Why |
|---|---|
| Claims / tasks / runner model | A document is not a work item. |
| SQLite control plane | SimpleMark has no server and no accounts |
