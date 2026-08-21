import type { AcceptedChangeRecord, BlockChange, SnapshotEntry } from '../../application/index.js'
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

/** Snapshots beside the document (ADR-0014), offered from the same surface. */
export interface SnapshotActions {
  /** The known snapshots, oldest first. Refreshed by the caller after writes. */
  readonly snapshots: () => readonly SnapshotEntry[]
  /** Takes a named snapshot now. */
  readonly snapshotNow: (label: string) => Promise<void>
  readonly restore: (id: string) => Promise<void>
  /** Blocks that differ between the snapshot and the document as it is now. */
  readonly compare: (id: string) => Promise<readonly BlockChange[]>
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
  /** Absent when the host has no snapshot store at all. */
  readonly snapshotActions?: SnapshotActions
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
    if (options.snapshotActions !== undefined) panel.append(snapshotSection(options.snapshotActions))
    return panel
  }

  /** Where a snapshot's compare view is open, so a repaint keeps it open. */
  let comparing: string | undefined
  let compareResult: readonly BlockChange[] | undefined

  function snapshotLabel(entry: SnapshotEntry): string {
    if (entry.label !== undefined) return entry.label
    if (entry.trigger === 'agent') return 'Before agent run'
    if (entry.trigger === 'restore') return 'Before restore'
    return 'Snapshot'
  }

  function snapshotStamp(entry: SnapshotEntry): string {
    return new Date(entry.createdMs).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  function snapshotSection(actions: SnapshotActions): HTMLElement {
    const section = document.createElement('section')
    section.className = 'sm-snapshots'
    section.setAttribute('aria-label', 'Snapshots')

    const title = document.createElement('h3')
    title.className = 'sm-snapshots-title'
    title.textContent = 'Snapshots'
    section.append(title)

    // Named on demand (ADR-0014 §3).
    const form = document.createElement('form')
    form.className = 'sm-snapshots-form'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'sm-snapshots-label'
    input.placeholder = 'Name this moment…'
    input.setAttribute('aria-label', 'Snapshot name')
    const take = document.createElement('button')
    take.type = 'submit'
    take.dataset['action'] = 'snapshot-now'
    take.textContent = 'Snapshot now'
    form.append(input, take)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const label = input.value.trim()
      if (label === '') {
        input.focus()
        return
      }
      void actions.snapshotNow(label).then(() => repaint())
    })
    section.append(form)

    const list = document.createElement('div')
    list.className = 'sm-snapshots-rows'
    const entries = [...actions.snapshots()].reverse()
    if (entries.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'sm-activity-empty'
      empty.textContent = 'No snapshots yet. One is taken before every agent run.'
      list.append(empty)
    }
    for (const entry of entries) {
      const row = document.createElement('article')
      row.className = 'sm-snapshot-row'
      row.dataset['snapshot'] = entry.id
      row.dataset['trigger'] = entry.trigger
      const name = document.createElement('p')
      name.className = 'sm-snapshot-name'
      name.textContent = snapshotLabel(entry)
      const meta = document.createElement('p')
      meta.className = 'sm-snapshot-meta'
      meta.textContent = `${snapshotStamp(entry)} · ${entry.trigger}`
      const rowActions = document.createElement('div')
      rowActions.className = 'sm-activity-actions'
      const restore = document.createElement('button')
      restore.type = 'button'
      restore.dataset['action'] = 'restore-snapshot'
      restore.textContent = 'Restore'
      restore.title = 'Bring the document back to this snapshot. The current text is snapshotted first.'
      restore.addEventListener('click', () => void actions.restore(entry.id).then(() => repaint()))
      const compare = document.createElement('button')
      compare.type = 'button'
      compare.dataset['action'] = 'compare-snapshot'
      compare.textContent = comparing === entry.id ? 'Hide compare' : 'Compare'
      compare.addEventListener('click', () => {
        if (comparing === entry.id) {
          comparing = undefined
          compareResult = undefined
          repaint()
          return
        }
        void actions.compare(entry.id).then((result) => {
          comparing = entry.id
          compareResult = result
          repaint()
        })
      })
      rowActions.append(restore, compare)
      row.append(name, meta, rowActions)
      if (comparing === entry.id && compareResult !== undefined) row.append(compareView(compareResult))
      list.append(row)
    }
    section.append(list)
    return section
  }

  /** Block-level compare (ADR-0014 §5): kept, added, removed, in order. */
  function compareView(changes: readonly BlockChange[]): HTMLElement {
    const view = document.createElement('div')
    view.className = 'sm-snapshot-compare'
    const changed = changes.filter((change) => change.kind !== 'same').length
    const summary = document.createElement('p')
    summary.className = 'sm-snapshot-compare-summary'
    summary.textContent = changed === 0
      ? 'Identical to the document now.'
      : changed === 1 ? '1 block differs' : `${changed} blocks differ`
    view.append(summary)
    for (const change of changes) {
      if (change.kind === 'same') continue
      const block = document.createElement('pre')
      block.className = 'sm-snapshot-block'
      block.dataset['kind'] = change.kind
      block.textContent = change.text
      view.append(block)
    }
    return view
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
