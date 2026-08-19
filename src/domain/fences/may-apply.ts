/**
 * Whether an agent write may land.
 *
 * Stop and Redirect bump `generation`. The agent still carries the old
 * number, so the write is refused rather than merged. Pause freezes the
 * runner between units without bumping, so a paused generation stays current
 * (SWITCHBOARD-KERNEL.md §2, MCP-SERVER.md §7).
 *
 * The generation is owned by the authority. The agent claims a number; it
 * never sets one.
 */

export type RunStatus =
  | 'starting'
  | 'thinking'
  | 'writing'
  | 'stopping'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

const TERMINAL: ReadonlySet<RunStatus> = new Set(['completed', 'cancelled', 'failed'])

export interface AgentRun {
  readonly runId: string
  readonly generation: number
  readonly status: RunStatus
}

export function mayApply(run: AgentRun, claimedGeneration: number): boolean {
  return (
    Number.isInteger(claimedGeneration) &&
    claimedGeneration >= 0 &&
    claimedGeneration === run.generation &&
    !TERMINAL.has(run.status)
  )
}
