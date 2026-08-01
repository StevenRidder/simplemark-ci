# `domain/fences`

Run generations and `mayApply` — what makes Stop and Redirect binding.

Ported in concept from Switchboard's `execution_liveness.py`: the generation
is owned by the app, never the agent, and malformed, future, stopped, and stale
generations all fail closed (SWITCHBOARD-KERNEL.md §2). Filled by the
live-agent deliverable.
