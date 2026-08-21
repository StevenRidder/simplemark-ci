import { makeDraggable } from '../../adapters/editor/draggable.js'
import { hasAgentTurn, matchAnchor, threadTurns } from '../../domain/index.js'
import type { Thread } from '../../domain/index.js'

/**
 * The conditional notes rail (ADR-0007), and the passage conversation (AGENT-9).
 *
 * No open threads, no rail element. An unmatched open thread is an orphan:
 * it keeps the original quote, tints nowhere, and offers reattach / detach /
 * remove. A matched open thread offers resolve.
 *
 * A matched thread also offers **Ask agent**, and that is the whole passage
 * conversation: the note body is the instruction, its anchor is the scope, and
 * the answer arrives as another turn in the same thread. There is no second
 * surface, because the wireframe is explicit that the conversation opens *at the
 * passage* and that a rail never exists for agents — what separates a note from
 * a conversation is that somebody answered, and the composer mode they used.
 *
 * Once a thread has an agent in it the composer appears, with the two modes that
 * must never be conflated: Leave note posts, Redirect now fences the current
 * generation and starts replacement work.
 */

export interface NoteRailActions {
  readonly resolve: (id: string) => void
  /** Brings a resolved thread back as an open note. */
  readonly reopen?: (id: string) => void
  readonly detach: (id: string) => void
  readonly remove: (id: string) => void
  readonly reattach: (id: string) => void
  /** Rewrites a note's body — the comment-edit every comment system has. */
  readonly editBody?: (id: string, body: string) => void
  /** Runs the agent against this thread's passage, using its body as the ask. */
  readonly askAgent?: (id: string) => void
  /** Sends a turn into the thread. `redirect` also fences the live generation. */
  readonly sendTurn?: (id: string, mode: 'note' | 'redirect', body: string) => void
}

export interface NoteRailOptions {
  /** Renders a turn's Markdown through the document's own pipeline. */
  readonly renderMarkdown?: (markdown: string) => DocumentFragment
  /** The thread whose passage an agent is working on right now. */
  readonly busyThreadId?: string
  /**
   * Hides the rail until the notes change.
   *
   * The rail is conditional, not permanent (ADR-0007) — but "conditional on
   * something being unresolved" is not the same as dismissable, and a reader
   * with a note they are not ready to resolve had no way to get the rail out of
   * the way. Absent leaves no control, for a caller with nowhere to keep the
   * state.
   */
  readonly onHide?: () => void
}

export function renderNoteRail(
  host: HTMLElement,
  threads: readonly Thread[],
  actions: NoteRailActions,
  documentText: string,
  waitingId?: string,
  options: NoteRailOptions = {},
): void {
  host.replaceChildren()
  const open = threads.filter((thread) => thread.state === 'open')
  const resolved = threads.filter((thread) => thread.state === 'resolved')
  if (open.length === 0 && (resolved.length === 0 || actions.reopen === undefined)) return

  const sorted = [...open].sort((left, right) => {
    const a = left.anchor?.blockIndex
    const b = right.anchor?.blockIndex
    if (a === undefined && b === undefined) return 0
    if (a === undefined) return 1
    if (b === undefined) return -1
    return a - b
  })

  const rail = document.createElement('aside')
  rail.className = 'sm-note-rail'
  rail.setAttribute('aria-label', 'Unresolved notes')

  if (options.onHide !== undefined) {
    const hide = document.createElement('button')
    hide.type = 'button'
    hide.className = 'sm-note-rail-hide'
    hide.dataset['action'] = 'hide-rail'
    hide.setAttribute('aria-label', 'Hide notes')
    hide.title = 'Hide notes — they come back when a note changes'
    hide.textContent = '×'
    hide.addEventListener('click', () => options.onHide?.())
    rail.append(hide)
  }

  for (const thread of sorted) {
    const matched =
      thread.anchor !== undefined && matchAnchor(thread.anchor, documentText) !== undefined
    const row = document.createElement('article')
    row.dataset['thread'] = thread.id
    row.dataset['orphan'] = matched ? 'false' : 'true'
    row.dataset['waiting'] = waitingId === thread.id ? 'true' : 'false'

    // Every turn, oldest first, the opening note included — a conversation that
    // rendered only the replies would hide what was asked.
    const conversational = hasAgentTurn(thread)
    row.dataset['conversation'] = String(conversational)
    for (const turn of threadTurns(thread)) {
      // Who said it, and when — stored since the beginning, painted never
      // (APP-41). "You" is the one name that needs no configuration.
      const byline = document.createElement('p')
      byline.className = 'sm-note-rail-byline'
      byline.dataset['author'] = turn.author
      const stamp = turnStamp(turn.createdAt)
      byline.textContent = stamp === undefined
        ? turnAuthorLabel(turn.author)
        : `${turnAuthorLabel(turn.author)} · ${stamp}`
      row.append(byline)
      const body = document.createElement('p')
      body.className = 'sm-note-rail-body'
      body.dataset['author'] = turn.author
      if (turn.mode !== undefined) body.dataset['mode'] = turn.mode
      if (options.renderMarkdown === undefined) {
        body.textContent = turn.body
      } else {
        body.append(options.renderMarkdown(turn.body))
      }
      row.append(body)
    }

    if (options.busyThreadId === thread.id) {
      const working = document.createElement('p')
      working.className = 'sm-note-rail-quote'
      working.dataset['state'] = 'working'
      working.textContent = 'Agent is working on this passage…'
      row.append(working)
    }

    if (!matched && thread.anchor !== undefined) {
      const quote = document.createElement('p')
      quote.className = 'sm-note-rail-quote'
      quote.textContent = `was on: "${thread.anchor.quote}"`
      row.append(quote)
    }

    if (waitingId === thread.id) {
      const hint = document.createElement('p')
      hint.className = 'sm-note-rail-quote'
      hint.textContent = 'Select the new passage'
      row.append(hint)
    }

    // Every note takes replies from birth (APP-41): a note to your later self
    // is a thread of one, and an agent joining later inherits the whole
    // conversation. Redirect appears only once there is an agent to redirect.
    if (actions.sendTurn !== undefined) {
      row.append(threadComposer(thread.id, actions.sendTurn, conversational))
    }

    const buttons = document.createElement('div')
    buttons.className = 'sm-note-rail-actions'
    if (matched) {
      // Not before the note has been written. Add Note creates the thread with
      // an empty body and opens its composer, so an Ask agent offered here reads
      // a body the reader is still typing — presses, and refuses. The button has
      // to appear only when there is an instruction for it to act on.
      const hasInstruction = thread.body.trim() !== ''
      if (actions.askAgent !== undefined && !conversational && hasInstruction) {
        // The wireframe's invocation: you select the passage, then ask. The note
        // body is the instruction and the anchor is the scope.
        //
        // Never disabled for "no provider configured". Whether one is configured
        // changes in Settings, which does not repaint this rail — so a button
        // disabled at paint time stayed disabled after the key was entered. The
        // run itself already answers "no document agent is configured" into the
        // thread, which is both current and self-explanatory.
        const ask = actionButton('ask-agent', 'Ask agent', () => actions.askAgent!(thread.id))
        ask.title = 'Ask the agent to act on this passage, using this note as the instruction'
        buttons.append(ask)
      }
      // Editing is for notes, not conversations: once an agent has answered,
      // rewriting the question it answered would falsify the thread.
      if (actions.editBody !== undefined && !conversational) {
        buttons.append(actionButton('edit-note', 'Edit', () => beginEdit(row, thread)))
      }
      buttons.append(actionButton('resolve', 'Resolve', () => actions.resolve(thread.id)))
    } else {
      buttons.append(
        actionButton('reattach', 'Reattach', () => actions.reattach(thread.id)),
        actionButton('detach', 'Keep as note', () => actions.detach(thread.id)),
        actionButton('remove', 'Delete', () => actions.remove(thread.id)),
      )
    }
    row.append(buttons)
    rail.append(row)
  }

  if (resolved.length > 0 && actions.reopen !== undefined) {
    // Google Docs keeps resolved comments in a history you can reopen from;
    // notes that vanish for good the moment Resolve is pressed read as data
    // loss, and were reported as exactly that.
    const section = document.createElement('details')
    section.className = 'sm-note-rail-resolved'
    const summary = document.createElement('summary')
    summary.textContent = resolved.length === 1 ? '1 resolved note' : `${resolved.length} resolved notes`
    section.append(summary)
    for (const thread of resolved) {
      const row = document.createElement('div')
      row.className = 'sm-note-rail-resolved-row'
      row.dataset['thread'] = thread.id
      const body = document.createElement('p')
      body.textContent = thread.body.trim() === '' ? '(empty note)' : thread.body
      const reopen = document.createElement('button')
      reopen.type = 'button'
      reopen.dataset['action'] = 'reopen'
      reopen.textContent = 'Reopen'
      reopen.title = 'Bring this note back to the passage it was on.'
      reopen.addEventListener('click', () => actions.reopen!(thread.id))
      // Forever means forever: no archive behind the archive. The title says
      // so, because this is the one button in the rail with no way back.
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.dataset['action'] = 'delete-forever'
      remove.textContent = 'Delete'
      remove.title = 'Deletes this note permanently. There is no undo.'
      remove.addEventListener('click', () => actions.remove(thread.id))
      row.append(body, reopen, remove)
      section.append(row)
    }
    rail.append(section)
  }

  host.append(rail)

  function beginEdit(row: HTMLElement, thread: Thread): void {
    if (row.querySelector('.sm-note-rail-edit') !== null) return
    const body = row.querySelector('.sm-note-rail-body')
    const editor = document.createElement('form')
    editor.className = 'sm-note-rail-edit'
    const input = document.createElement('textarea')
    input.setAttribute('aria-label', 'Edit note')
    input.value = thread.body
    editor.append(input)
    const save = document.createElement('button')
    save.type = 'submit'
    save.dataset['action'] = 'save-edit'
    save.textContent = 'Save'
    editor.append(save)
    editor.addEventListener('submit', (event) => {
      event.preventDefault()
      const next = input.value.trim()
      if (next === '') return
      actions.editBody!(thread.id, next)
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        editor.requestSubmit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        editor.remove()
        if (body instanceof HTMLElement) body.style.display = ''
      }
    })
    if (body instanceof HTMLElement) body.style.display = 'none'
    row.prepend(editor)
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }
}

/** The popover that a tint click opens — one note, or the stack on that passage. */
export function renderNoteStack(host: HTMLElement, threads: readonly Thread[], origin?: DOMRect): void {
  host.replaceChildren()
  if (threads.length === 0) return

  const stack = document.createElement('div')
  stack.className = 'sm-note-stack'
  stack.setAttribute('role', 'dialog')
  stack.setAttribute('aria-label', threads.length > 1 ? 'Notes on this passage' : 'Note')

  for (const thread of threads) {
    const item = document.createElement('article')
    item.dataset['thread'] = thread.id
    const body = document.createElement('p')
    body.className = 'sm-note-stack-body'
    body.textContent = thread.body
    item.append(body)
    stack.append(item)
  }

  makeDraggable(stack)
  host.append(stack)
  if (origin === undefined) return
  const hostBox = host.getBoundingClientRect()
  stack.style.top = `${Math.max(8, origin.bottom - hostBox.top + 8)}px`
  stack.style.left = `${Math.max(8, origin.left - hostBox.left)}px`
}

/**
 * The two composer modes, at the passage.
 *
 * Two buttons rather than a mode plus one Send: there is no stored mode to be
 * wrong about when you press, which is the cheapest possible guarantee that
 * communication and control cannot be conflated. A message reading "stop" sent
 * with Leave note is a message (SWITCHBOARD-KERNEL.md §5).
 */
function turnAuthorLabel(author: string): string {
  if (author === 'local') return 'You'
  if (author === 'agent') return 'Agent'
  return author
}

/** A short local stamp, or nothing for a turn whose date never parsed. */
function turnStamp(createdAt: string): string | undefined {
  const time = Date.parse(createdAt)
  if (Number.isNaN(time)) return undefined
  return new Date(time).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function threadComposer(
  threadId: string,
  send: (id: string, mode: 'note' | 'redirect', body: string) => void,
  conversational: boolean,
): HTMLElement {
  const composer = document.createElement('form')
  composer.className = 'sm-note-rail-composer'

  const input = document.createElement('textarea')
  input.className = 'sm-note-rail-input'
  input.setAttribute('aria-label', conversational ? 'Reply in this passage conversation' : 'Add a reply to this note')
  input.placeholder = conversational ? 'To the agent…' : 'Add a reply…'
  composer.append(input)

  const buttons = document.createElement('div')
  buttons.className = 'sm-note-rail-actions'
  // Redirect fences a live generation; a thread with no agent in it has
  // nothing to fence, and offering the button would imply otherwise.
  const modes = conversational ? (['redirect', 'note'] as const) : (['note'] as const)
  for (const mode of modes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['action'] = mode === 'redirect' ? 'redirect-now' : 'leave-note'
    button.textContent = mode === 'redirect' ? 'Redirect now' : 'Leave note'
    button.title = mode === 'redirect'
      ? 'Fences what the agent is doing and starts again from this'
      : 'Posts this into the thread. Changes nothing the agent is doing.'
    button.addEventListener('click', () => {
      const body = input.value.trim()
      if (body === '') return
      input.value = ''
      send(threadId, mode, body)
    })
    buttons.append(button)
  }
  composer.append(buttons)
  composer.addEventListener('submit', (event) => event.preventDefault())
  return composer
}

function actionButton(action: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset['action'] = action
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}
