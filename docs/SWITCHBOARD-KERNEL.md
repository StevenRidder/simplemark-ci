# What SimpleMark takes from Switchboard

**Four patterns and one file. Not the backend, not the codebase, not the model.**

- **Status:** Draft 1
- **Date:** 2026-08-01
- **Reviewed:** `6th-Element-Labs/projectplanner` @ `98b7eee8` — 361 Python modules, `src/switchboard/{domain,application,storage,mcp,contracts}`
- **Companion to:** [`COLLABORATION.md`](COLLABORATION.md)

---

## 1. The verdict

**Do not build SimpleMark on Switchboard.** It is a task-completion control plane: claims, runner lifecycle, CI and merge provenance, project authorization, 33 MCP tools, ~200 test modules. Transplanting it would make a lightweight notebook feel like air-traffic control.

**Do take four patterns.** Switchboard has already paid for the mistakes that agent-in-a-document will otherwise make, and one of its modules is portable almost verbatim in concept.

| Take | From | Why |
|---|---|---|
| **The fence** | `src/switchboard/domain/execution_liveness.py` (193 lines, pure) | Reliable interruption. This is the important one. |
| **Exactly-once effects** | `src/switchboard/storage/repositories/external_effects.py` (333 lines) | "Insert this diagram" must not insert it twice |
| **Thin adapter over shared commands** | `application/commands/*` (28) ← `mcp/tools/*` (33) | MCP calls a document service; it never touches Yjs or files directly |
| **Communication ≠ control** | ADR-0008 | A comment saying "stop" is not proof anything stopped |

---

## 2. The fence — the one worth copying closely

`execution_liveness.py` is **pure**: no storage, no I/O, no framework. It answers one question — *is this managed execution alive, and may it act?* — from exactly two facts: lifecycle status and lease expiry.

Two functions carry the idea:

```python
def is_live(row, *, now) -> bool:
    """Alive means BOTH halves hold: status is not terminal, and the lease
    has not lapsed. Either alone is insufficient — a terminal row with a
    fresh heartbeat is dead, and a 'running' row whose host stopped
    heartbeating is dead once its TTL passes."""

def heartbeat_is_fenced(row, *, claimed_epoch) -> bool:
    """True when a heartbeat does not carry the exact current fence epoch.
    A superseded generation may still have a live process briefly. Its
    renewals must not resurrect the lease... Future and malformed epochs
    also fail closed: the fence is server-owned."""
```

The header comment records why it exists, and it is the lesson:

> *Before SIMPLIFY-18 the repo carried at least six spellings of the terminal status set and several independent staleness computations, so the answer varied by caller.*

**Six different opinions about whether a thing was still running.** That is exactly the bug SimpleMark would ship if "is this agent still allowed to edit?" were computed at each call site.

### 2.1 What it becomes in SimpleMark

Every agent operation gets a **run id and a generation**. Interrupting or redirecting bumps the fence:

```text
You:    "draft the architecture section"     → run 17, fence 3, scope = §Architecture
You:    "stop — optimise for iPad"           → fence bumps to 4; run 17 is fenced
Agent:  late response from run 17 arrives    → REJECTED, cannot touch the document
You:    new instruction                      → run 18, fence 4, fresh scope
```

**This is what makes interruption real.** Without it, an agent that was three seconds into generating a table lands its edit *after* you told it to stop, and the stop looks broken. [`COLLABORATION.md`](COLLABORATION.md) §5.4 gives the interrupt an out-of-band channel; the fence is what makes the interrupt binding.

Ported to TypeScript this is roughly 80 lines and no dependencies:

```ts
export interface AgentRun {
  runId: string
  generation: number      // bumped by interrupt, redirect, or scope change
  scope: RegionAnchor
  status: 'starting' | 'thinking' | 'writing' | 'stopping'
          | 'completed' | 'cancelled' | 'failed'
}

/** A result is accepted only from the current, non-terminal generation. */
export function mayApply(run: AgentRun, claimedGeneration: number): boolean {
  return claimedGeneration === run.generation && !TERMINAL.has(run.status)
}
```

Malformed, future, stopped, and stale generations fail closed. The generation is owned by the
app, never by the agent. The local POC also aborts the in-flight request; the fence is the
backstop if a provider returns anyway. Heartbeats and TTLs belong only in a later remote-runner
design where an operation can genuinely be orphaned.

---

## 3. Exactly-once — so retries don't duplicate

`external_effects.py` implements a `claimed → issued → verified` ledger keyed by `(effect_type, target, resource)` plus an idempotency key and a time window. A replayed claim returns `{"idempotent": true}` rather than performing the effect again.

SimpleMark's version of the same problem: an agent asks to insert a Mermaid block, the connection drops, it retries. Without a key you get the diagram twice.

```ts
apply_transaction(docId, {
  idemKey: 'run17:insert-arch-diagram',
  runId: 'run17', generation: 4,
  name: 'Added architecture diagram',
  ops: [...]
})
```

Replaying that key inside the window returns the original transaction id and applies nothing. Cheap, and it removes a whole class of "why are there two diagrams" reports.

---

## 4. Thin adapter over shared commands

Switchboard's structure is worth copying wholesale, because it is what keeps 33 MCP tools from each inventing their own rules:

```
mcp/tools/claims.py (298 lines)  →  application/commands/complete_claim.py
                                 →  storage/repositories/claims.py
```

The MCP tool's own docstring states the boundary:

> *Transport adapter for claim_task / claim_next / complete_claim. Authentication, identity binding, and MCP serialization remain edge concerns; the shared application commands used by REST own transport-neutral validation.*

**For SimpleMark:** MCP tools must never touch Yjs state or the filesystem directly. They call a `DocumentSession` service that owns scope checks, fence checks, idempotency, and transaction naming — the same service the app's own UI calls. One set of rules, two transports.

This is the difference between an agent surface that stays correct and one where the fifth tool forgets to check the fence.

---

## 5. Communication is not control

ADR-0008's first plane separation: *a message has zero lifecycle authority.* A comment addressed to an agent — even one saying "STOP" — is a message. It has no power on its own.

So in SimpleMark:

- Typing "stop" in a comment thread **posts a comment**. It does nothing else.
- The **Stop** button bumps the fence. That is what stops the agent.
- The two may be wired together, but the causal path runs through the fence, never through the text.

Switchboard learned this by having message-ish events cause lifecycle effects and then having to unpick it. Free lesson.

---

## 6. What NOT to borrow

| Not taken | Why |
|---|---|
| Claims / tasks / runner model | A document is not a work item. Many humans edit freely; agents contribute within temporary scopes. Different shape entirely. |
| SQLite control plane, project authorization | SimpleMark has no server and no accounts |
| Coordinator daemon, mission graph, CI provenance | Nothing in a notebook needs verified completion |
| The 200-module test suite's assumptions | Different domain |

**The concrete difference:**

```text
Switchboard: one actor owns a bounded work item through verified completion
SimpleMark:  many actors edit freely; agents act within temporary, revocable scope
```

---

## 7. The extracted kernel

Everything above collapses to one small object:

```text
DocumentSession
  ├─ CRDT text/block state              (Yjs)
  ├─ participant presence               (awareness)
  ├─ agent run registry
  │    └─ runId · generation · scope anchor · status · cancel state
  ├─ transaction / activity log         (named, grouped, revertible)
  └─ Markdown materializer              (D7 source preservation)
```

Four of those five come straight from Switchboard's hard-won shape. None of them come from its code.

---

## 8. Switchboard as a testbed

It already has agents, messages, execution identity, scope authority, and a live MCP surface — plus a fleet actually running against it. It is a reasonable place to **prototype the agent-room protocol** and find out what breaks, before any of it exists in SimpleMark.

What it is not: a runtime dependency, a backend, or a starting codebase.
