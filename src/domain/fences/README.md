# `domain/fences`

Run generations and `mayApply` — what makes Stop and Redirect binding.

`mayApply(run, claimedGeneration)` is true only when the claimed generation
equals the run's current one, the claim is a non-negative integer, and the
run is not terminal. Pause is not terminal: it freezes the runner between
units without bumping the generation.

The generation is owned by the authority, never by the agent. Ported in
concept from Switchboard's `execution_liveness.py` (SWITCHBOARD-KERNEL.md §2).
