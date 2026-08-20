import type { AcceptedChangeRecord } from '../../application/index.js'
import { tablerIcon } from './tabler-icons.js'

/**
 * The Activity timeline (AGENT-10, wireframe §2).
 *
 * "Named transactions you can inspect, jump to, or revert. Opened
 * deliberately." Three words in that sentence are load-bearing.
 *
 * **Named.** Rows carry what the change was for, not what tool did it. A
 * timeline of identical rows is one nobody opens, which is why naming shipped
 * with this rather than after it.
 *
 * **Revert.** `DocumentSession.revert` applies one transaction's inverse over
 * everything that came after it, so reverting an agent edit does not take a
 * reader's later typing with it. A row whose inverse was never stored says
 * Revert is unavailable rather than offering a button that refuses.
 *
 * **Opened deliberately.** Absent from the DOM until asked for, like the agent
 * panel and the notes rail: `DESIGN.md` §9 forbids a resident activity rail, and
 * this is the surface that sentence is most obviously about.
 */

export interface ActivityTimelineActions {
  /** Brings the change's own passage into view. */
  jumpTo(transactionId: string): void
  /**
   * Undoes one named transaction, keeping later edits. False when the
   * authority refused — the row must not claim a revert that never happened.
   */
  revert(transactionId: string): boolean
}

export interface ActivityTimeline {
  readonly host: HTMLElement
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** Repaints from the log. A no-op while closed. */
  repaint(): void
}

export interface ActivityTimelineOptions extends ActivityTimelineActions {
  /** Told whenever the timeline closes itself, so a toggle can stay truthful. */
  readonly onClosed?: () => void
  /** The accepted-change log, newest last. */
  readonly history: () => readonly AcceptedChangeRecord[]
  /** Which actor is this person, so their own edits read as theirs. */
  readonly humanActor?: string
  /**
   * Where a change landed, when that is known.
   *
   * The session sequences opaque steps and cannot say where one applied, so
   * positions are recorded as changes arrive. Undefined hides Jump to on that
   * row rather than offering a button that goes nowhere.
   */
  readonly positionOf?: (transactionId: string) => number | undefined
}

export function createActivityTimeline(options: ActivityTimelineOptions): ActivityTimeline {
  const host = document.createElement('div')
  host.className = 'sm-activity-host'
  const human = options.humanActor ?? 'human'
  let open = false
  /** Rows the reader has reverted this session, so the row can say so. */
  const reverted = new Set<string>()

  function row(record: AcceptedChangeRecord): HTMLElement {
    const item = document.createElement('article')
    item.className = 'sm-activity-row'
    item.dataset['transaction'] = record.transactionId
    item.dataset['actor'] = record.actorId
    item.dataset['revertible'] = String(record.revertible)

    const who = document.createElement('span')
    who.className = 'sm-activity-actor'
    who.textContent = record.actorId === human ? 'You' : record.actorId
    const name = document.createElement('p')
    name.className = 'sm-activity-name'
    name.textContent = record.name
    item.append(who, name)

    const actions = document.createElement('div')
    actions.className = 'sm-activity-actions'

    if (options.positionOf?.(record.transactionId) !== undefined) {
      const jump = document.createElement('button')
      jump.type = 'button'
      jump.dataset['action'] = 'jump-to'
      jump.textContent = 'Jump to'
      jump.addEventListener('click', () => options.jumpTo(record.transactionId))
      actions.append(jump)
    }

    if (reverted.has(record.transactionId)) {
      const done = document.createElement('span')
      done.className = 'sm-activity-reverted'
      done.textContent = 'reverted'
      actions.append(done)
    } else if (record.revertible) {
      // Any revertible row, not only the newest: the inverse is positioned
      // through later batches' step maps without replaying them, so a
      // paragraph typed afterwards survives the revert (BUG-9). The authority
      // still refuses when a later edit consumed the passage; the row is
      // marked reverted only when it actually happened.
      const revert = document.createElement('button')
      revert.type = 'button'
      revert.dataset['action'] = 'revert'
      revert.textContent = 'Revert'
      revert.title = 'Undo this change. Later edits stay.'
      revert.addEventListener('click', () => {
        // Marked before the call: a successful revert repaints this panel from
        // inside it, and the repaint must already see the row as reverted.
        reverted.add(record.transactionId)
        if (!options.revert(record.transactionId)) reverted.delete(record.transactionId)
      })
      actions.append(revert)
    } else {
      // Honest rather than hopeful: no inverse was stored — a live typing
      // batch, a whole-document barrier.
      const why = document.createElement('span')
      why.className = 'sm-activity-unavailable'
      why.textContent = 'not separately revertible'
      why.title = 'No inverse was stored for this change. Ordinary undo still applies.'
      actions.append(why)
    }

    item.append(actions)
    return item
  }

  function build(): HTMLElement {
    const panel = document.createElement('aside')
    panel.className = 'sm-activity'
    panel.setAttribute('role', 'complementary')
    panel.setAttribute('aria-label', 'Activity')

    const header = document.createElement('header')
    header.className = 'sm-activity-header'
    const title = document.createElement('span')
    title.className = 'sm-activity-title'
    title.textContent = 'Activity'
    const close = document.createElement('button')
    close.type = 'button'
    close.dataset['action'] = 'close-activity'
    close.className = 'sm-activity-close'
    close.setAttribute('aria-label', 'Close activity')
    close.innerHTML = tablerIcon('x')
    close.addEventListener('click', () => closePanel())
    header.append(title, close)

    const list = document.createElement('div')
    list.className = 'sm-activity-rows'
    // Newest first: the change you are asking about is almost always the last
    // one that happened.
    const records = [...options.history()].reverse()
    if (records.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'sm-activity-empty'
      empty.textContent = 'Nothing has changed this document yet.'
      list.append(empty)
    } else {
      for (const record of records) list.append(row(record))
    }

    panel.append(header, list)
    return panel
  }

  function repaint(): void {
    if (!open) return
    host.replaceChildren(build())
  }

  function openPanel(): void {
    open = true
    host.replaceChildren(build())
  }

  function closePanel(): void {
    open = false
    // Absent, not hidden: `DESIGN.md` §9 forbids a resident activity rail.
    host.replaceChildren()
    options.onClosed?.()
  }

  return {
    host,
    open: openPanel,
    close: closePanel,
    toggle: () => (open ? closePanel() : openPanel()),
    isOpen: () => open,
    repaint,
  }
}
