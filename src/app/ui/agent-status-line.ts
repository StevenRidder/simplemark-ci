import type { AgentActivity } from '../../application/index.js'

/**
 * The compact in-document status line (COLLABORATION.md §6.4, APP-32).
 *
 * Not part of the conversation panel, and that separation is the point: a run
 * has to be legible to a reader who never opened the panel, and an agent may be
 * working on the note in front of them while the panel is closed (ADR-0012 §4).
 *
 * Three rules it enforces rather than merely displays:
 *
 * **Follow is opt-in.** The page never moves on its own. `onFollow` is called
 * only while the reader has switched Follow on, so an agent working elsewhere in
 * a long document cannot pull the viewport away from what is being read.
 *
 * **Pause is not Stop.** Pause freezes further writes and leaves the run alive
 * and resumable; Stop bumps the generation and ends it. They are separate
 * controls with separate labels, because a reader who wants to type for a minute
 * is asking for a different thing from a reader who wants the work abandoned.
 *
 * **Absent when idle.** No run, no status line. A document nothing is editing
 * looks exactly as it did before an agent existed.
 */

export interface AgentStatusActions {
  pause(): void
  resume(): void
  stop(): void
  /** Reveal the range the agent just wrote. Called only while Follow is on. */
  follow(range: { readonly from: number; readonly to: number }): void
}

export interface AgentStatusLine {
  readonly host: HTMLElement
  /** Paints one observation. `undefined` clears the line entirely. */
  show(activity: AgentActivity | undefined): void
  /** Whether the reader has opted into following the agent. */
  isFollowing(): boolean
}

const TERMINAL: ReadonlySet<AgentActivity['status']> = new Set([
  'cancelled',
  'completed',
  'failed',
])

/**
 * Terminal statuses that clear the line instead of parking on it.
 *
 * "No run, no status line" is the rule, and a finished run is not a run: a
 * permanent `Finished` bar under the titlebar is the drift into a status rail
 * that `DESIGN.md` §9 forbids. A completed run is already visible as the edit
 * itself, and a cancelled one was cancelled by the reader, who knows.
 *
 * `failed` is deliberately not here. A failure that vanished would be a silent
 * one, and with the panel closed the line is the only place it appears.
 */
const SELF_CLEARING: ReadonlySet<AgentActivity['status']> = new Set(['cancelled', 'completed'])

export function createAgentStatusLine(actions: AgentStatusActions): AgentStatusLine {
  const host = document.createElement('div')
  host.className = 'sm-agent-status-host'

  let following = false
  let lastFollowed: string | undefined

  function build(activity: AgentActivity): HTMLElement {
    const line = document.createElement('div')
    line.className = 'sm-agent-status'
    line.dataset['status'] = activity.status
    // A live region, not a focus move: the reader is told without being taken
    // anywhere. `polite` so it never interrupts a screen reader mid-sentence.
    line.setAttribute('role', 'status')
    line.setAttribute('aria-live', 'polite')

    const detail = document.createElement('span')
    detail.className = 'sm-agent-status-detail'
    detail.dataset['detail'] = activity.detail
    detail.textContent = activity.detail
    line.append(detail)

    if (activity.writes > 0) {
      const writes = document.createElement('span')
      writes.className = 'sm-agent-status-writes'
      writes.dataset['writes'] = String(activity.writes)
      writes.textContent = activity.writes === 1 ? '1 change' : `${activity.writes} changes`
      line.append(writes)
    }

    if (TERMINAL.has(activity.status)) return line

    const followToggle = document.createElement('button')
    followToggle.type = 'button'
    followToggle.className = 'sm-agent-follow'
    followToggle.dataset['action'] = 'follow'
    followToggle.setAttribute('aria-pressed', String(following))
    followToggle.textContent = 'Follow'
    followToggle.title = following
      ? 'Following the agent. Press to stop moving the page.'
      : 'Move the page to each agent edit. Off by default.'
    followToggle.addEventListener('click', () => {
      following = !following
      // Turning Follow on does not jump anywhere by itself; the next write is
      // what moves the page. Turning it on retroactively yanking the viewport
      // is the behaviour this control exists to prevent.
      lastFollowed = undefined
      show(activity)
    })
    line.append(followToggle)

    const paused = activity.status === 'paused'
    const pause = document.createElement('button')
    pause.type = 'button'
    pause.className = 'sm-agent-pause'
    pause.dataset['action'] = paused ? 'resume' : 'pause'
    pause.textContent = paused ? 'Resume agent edits' : 'Pause agent edits'
    pause.title = paused
      ? 'Let the agent write again. The run never ended.'
      : 'Stop further agent writes. The run stays alive and resumable.'
    pause.addEventListener('click', () => (paused ? actions.resume() : actions.pause()))
    line.append(pause)

    const stop = document.createElement('button')
    stop.type = 'button'
    stop.className = 'sm-agent-stop'
    stop.dataset['action'] = 'stop'
    stop.textContent = 'Stop'
    stop.title = 'End this run. A superseded edit cannot land afterwards.'
    stop.addEventListener('click', () => actions.stop())
    line.append(stop)

    return line
  }

  function show(activity: AgentActivity | undefined): void {
    if (activity === undefined || SELF_CLEARING.has(activity.status)) {
      host.replaceChildren()
      lastFollowed = undefined
      return
    }
    host.replaceChildren(build(activity))

    if (!following || activity.range === undefined) return
    // One reveal per write, not per repaint: the same range arriving again as a
    // status change must not re-scroll a reader who has since scrolled away.
    const key = `${activity.writes}:${activity.range.from}:${activity.range.to}`
    if (key === lastFollowed) return
    lastFollowed = key
    actions.follow(activity.range)
  }

  return { host, show, isFollowing: () => following }
}
