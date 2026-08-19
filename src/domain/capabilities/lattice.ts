/**
 * Who may write, and who may invite whom.
 *
 * Rank is total: owner > editor > commenter > reader. A grant must be
 * strictly narrower than the granter, checked when issued and again on
 * every call because the inviter may have been demoted since
 * (MCP-SERVER.md §3.1, COLLABORATION.md §3.3).
 *
 * Only owner and editor may write. A commenter agent is proposal-only
 * by construction.
 */

export type Capability = 'owner' | 'editor' | 'commenter' | 'reader'

const RANK: Record<Capability, number> = {
  owner: 3,
  editor: 2,
  commenter: 1,
  reader: 0,
}

export function mayWrite(capability: Capability): boolean {
  return capability === 'owner' || capability === 'editor'
}

export function mayIssueGrant(granter: Capability, grant: Capability): boolean {
  return RANK[grant] < RANK[granter]
}

export function mayWriteAtCall(agent: Capability, inviterNow: Capability): boolean {
  return mayIssueGrant(inviterNow, agent) && mayWrite(agent)
}
