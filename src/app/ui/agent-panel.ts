import { makeDraggable } from '../../adapters/editor/draggable.js'
import { stampLabel } from './stamps.js'
import type { AgentConversation, ComposerMode, ConversationMessage } from '../agent-conversation.js'
import { tablerIcon } from './tabler-icons.js'

/**
 * The app-level agent conversation panel (ADR-0012).
 *
 * Three constraints from that decision are structural here, not stylistic:
 *
 * **Absent, not collapsed.** Closing empties the host, so with the panel closed
 * no panel element exists at all — the same standard `DESIGN.md` §9 sets for the
 * notes rail. A hidden-but-present panel would fail the rule it was granted an
 * exception under, so `close()` removes rather than hides.
 *
 * **Only a person opens it.** Nothing in this module opens the panel. `open()`
 * exists for the toggle to call; a run starting, an edit landing, an error, or a
 * question arriving all repaint whatever is already on screen and nothing more.
 * The status line and the note-row marker are what carry a run to a reader who
 * has the panel closed.
 *
 * **Never steals focus.** Only `open()` moves focus, and only into the composer,
 * because a person just asked for it. `repaint()` restores the caret it found so
 * an arriving message cannot interrupt typing.
 */

export interface AgentQuestion {
  readonly reason: 'missing' | 'ambiguous'
  readonly quote: string
  /**
   * Character offsets of each occurrence, for the ambiguous case.
   *
   * The reader picks one; the application never guesses. Empty for `missing`.
   */
  readonly occurrences: readonly number[]
}

export interface AgentPanelOptions {
  /** Told whenever the panel closes itself, so a toggle can stay truthful. */
  readonly onClosed?: () => void
  readonly conversation: AgentConversation
  /** The document's own Markdown pipeline (`StepDocumentAdapter.renderMarkdown`). */
  readonly renderMarkdown: (markdown: string) => DocumentFragment
  readonly onSend: (mode: ComposerMode, markdown: string) => void
  /** A reader answering "which one?" with the occurrence they meant. */
  readonly onAnswerQuestion: (occurrence: number) => void
  /** Whether a provider is configured. False shows why, and disables Send. */
  readonly isConfigured: () => boolean
  readonly onOpenSettings: () => void
  /**
   * What a send would touch right now (APP-40). The rule was always
   * selection-or-chat; the chip is the rule made visible before the press.
   */
  readonly scopeState?: () => { readonly label: string; readonly kind: 'selection' | 'pinned' | 'document' }
  /** The document's headings, for aiming an ask without leaving the panel. */
  readonly headings?: () => readonly { readonly label: string }[]
  /** Pins a heading's section as the scope (by index), or clears the pin. */
  readonly onPinScope?: (index: number | undefined) => void
}

export interface AgentPanel {
  /** Mount point that stays in the layout. Empty whenever the panel is closed. */
  readonly host: HTMLElement
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** Rebuilds the visible panel from state. A no-op while closed. */
  repaint(): void
  /** Shows or clears "which passage did you mean?". Never opens the panel. */
  setQuestion(question: AgentQuestion | undefined): void
  /** Updates only the scope chip — selection changes must not rebuild a composer someone is typing into. */
  refreshScope(): void
}

const MODE_LABEL: Record<ComposerMode, string> = {
  note: 'Leave note',
  redirect: 'Redirect',
}

const MODE_HINT: Record<ComposerMode, string> = {
  note: 'Posts a message. Changes nothing the agent is doing.',
  redirect: 'Stops the current work and starts again from this instruction.',
}

export function createAgentPanel(options: AgentPanelOptions): AgentPanel {
  const host = document.createElement('div')
  host.className = 'sm-agent-panel-host'

  let open = false
  let mode: ComposerMode = 'note'
  let draft = ''
  let editing: string | undefined
  /**
   * The in-progress correction body.
   *
   * Held here rather than only in the textarea, because a repaint rebuilds the
   * whole panel: an agent message arriving mid-correction would otherwise reset
   * the box to the original text and throw away what was being typed.
   */
  let editingDraft: string | undefined
  /** Whether the correction box has already been given focus this time round. */
  let editorFocused = false
  let question: AgentQuestion | undefined
  /** Repaints just the chip; undefined while the composer is not built. */
  let scopeChipPaint: (() => void) | undefined

  function messageElement(message: ConversationMessage): HTMLElement {
    const article = document.createElement('article')
    article.className = 'sm-agent-message'
    article.dataset['message'] = message.id
    article.dataset['author'] = message.author
    if (message.mode !== undefined) article.dataset['mode'] = message.mode
    article.dataset['edited'] = String(message.edited)

    const byline = document.createElement('header')
    byline.className = 'sm-agent-message-byline'
    const who = document.createElement('span')
    // The same byline a note card carries (APP-48): who, and when.
    const stamp = stampLabel(message.at)
    const label = message.author === 'you' ? 'You' : 'Agent'
    who.textContent = stamp === undefined ? label : `${label} · ${stamp}`
    byline.append(who)
    if (message.mode !== undefined) {
      // The composer mode is recorded on the message so the sequence stays
      // understandable later: which of these actually fenced a generation?
      const badge = document.createElement('span')
      badge.className = 'sm-agent-message-mode'
      badge.textContent = MODE_LABEL[message.mode]
      byline.append(badge)
    }
    if (message.edited) {
      const edited = document.createElement('span')
      edited.className = 'sm-agent-message-edited'
      edited.textContent = 'edited'
      byline.append(edited)
    }
    article.append(byline)

    if (editing === message.id) {
      article.append(editor(message))
      return article
    }

    const body = document.createElement('div')
    body.className = 'sm-agent-message-body'
    body.append(options.renderMarkdown(message.markdown))
    article.append(body)

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'sm-agent-message-edit'
    edit.dataset['action'] = 'edit-message'
    edit.textContent = 'Edit'
    edit.setAttribute('aria-label', `Edit this message`)
    edit.addEventListener('click', () => {
      editing = message.id
      editingDraft = message.markdown
      editorFocused = false
      repaint()
    })
    article.append(edit)
    return article
  }

  /** In-place correction. Saving replaces the body; it never appends a reply. */
  function editor(message: ConversationMessage): HTMLElement {
    const form = document.createElement('div')
    form.className = 'sm-agent-message-editor'

    const input = document.createElement('textarea')
    input.className = 'sm-agent-message-input'
    input.setAttribute('aria-label', 'Correct this message')
    input.value = editingDraft ?? message.markdown
    input.addEventListener('input', () => {
      editingDraft = input.value
    })
    form.append(input)

    const actions = document.createElement('div')
    actions.className = 'sm-agent-message-actions'

    const save = document.createElement('button')
    save.type = 'button'
    save.dataset['action'] = 'save-message'
    save.textContent = 'Save'
    save.addEventListener('click', () => {
      // Correcting a message re-sends nothing and changes no authority. It is
      // an edit to app state, which is the whole difference from a new message.
      if (!options.conversation.edit(message.id, input.value)) return
      editing = undefined
      editingDraft = undefined
      repaint()
    })

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.dataset['action'] = 'cancel-message'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => {
      editing = undefined
      editingDraft = undefined
      editorFocused = false
      repaint()
    })

    actions.append(save, cancel)
    form.append(actions)
    // Focus moves here because the reader pressed Edit — a deliberate request,
    // not the panel taking attention on its own. Only on that press: a repaint
    // caused by an arriving message must not pull the caret back.
    if (!editorFocused) {
      editorFocused = true
      requestAnimationFrame(() => input.focus())
    }
    return form
  }

  function questionElement(current: AgentQuestion): HTMLElement {
    const box = document.createElement('div')
    box.className = 'sm-agent-question'
    box.dataset['reason'] = current.reason
    box.setAttribute('role', 'group')

    const asked = document.createElement('p')
    asked.className = 'sm-agent-question-text'
    asked.textContent = current.reason === 'ambiguous'
      ? `“${current.quote}” appears ${current.occurrences.length} times. Which one?`
      : `“${current.quote}” is not in this note. Nothing has been edited.`
    box.append(asked)

    if (current.reason === 'ambiguous') {
      const choices = document.createElement('div')
      choices.className = 'sm-agent-question-choices'
      current.occurrences.forEach((offset, index) => {
        const choice = document.createElement('button')
        choice.type = 'button'
        choice.dataset['action'] = 'answer-question'
        choice.dataset['occurrence'] = String(offset)
        choice.textContent = `Occurrence ${index + 1}`
        choice.addEventListener('click', () => options.onAnswerQuestion(offset))
        choices.append(choice)
      })
      box.append(choices)
    }
    return box
  }

  function composerElement(): HTMLElement {
    const composer = document.createElement('form')
    composer.className = 'sm-agent-composer'
    composer.dataset['mode'] = mode

    if (options.scopeState !== undefined) {
      const scopeRow = document.createElement('div')
      scopeRow.className = 'sm-agent-scope'
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'sm-agent-scope-chip'
      chip.dataset['action'] = 'scope-chip'
      const paint = (): void => {
        const state = options.scopeState!()
        chip.dataset['kind'] = state.kind
        chip.textContent = state.label
        chip.title = state.kind === 'document'
          ? 'Nothing is selected: sending chats about the whole document and edits nothing. Click to aim at a section.'
          : 'This is what a send will act on. Click to aim at a section instead.'
      }
      paint()
      scopeChipPaint = paint
      const menu = document.createElement('div')
      menu.className = 'sm-agent-scope-menu'
      menu.hidden = true
      chip.addEventListener('click', () => {
        if (!menu.hidden) {
          menu.hidden = true
          return
        }
        menu.replaceChildren()
        const clear = document.createElement('button')
        clear.type = 'button'
        clear.dataset['action'] = 'scope-clear'
        clear.textContent = 'Whole document (chat only)'
        clear.addEventListener('click', () => {
          options.onPinScope?.(undefined)
          menu.hidden = true
          paint()
        })
        menu.append(clear)
        for (const [index, heading] of (options.headings?.() ?? []).entries()) {
          const item = document.createElement('button')
          item.type = 'button'
          item.dataset['action'] = 'scope-heading'
          item.textContent = heading.label
          item.addEventListener('click', () => {
            options.onPinScope?.(index)
            menu.hidden = true
            paint()
          })
          menu.append(item)
        }
        menu.hidden = false
      })
      scopeRow.append(chip, menu)
      composer.append(scopeRow)
    }

    const modes = document.createElement('div')
    modes.className = 'sm-agent-modes'
    modes.setAttribute('role', 'radiogroup')
    modes.setAttribute('aria-label', 'What sending does')
    for (const candidate of ['note', 'redirect'] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset['action'] = `mode-${candidate}`
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(mode === candidate))
      button.textContent = MODE_LABEL[candidate]
      button.title = MODE_HINT[candidate]
      button.addEventListener('click', () => {
        mode = candidate
        repaint()
      })
      modes.append(button)
    }

    const hint = document.createElement('p')
    hint.className = 'sm-agent-mode-hint'
    hint.textContent = MODE_HINT[mode]

    const input = document.createElement('textarea')
    input.className = 'sm-agent-composer-input'
    input.setAttribute('aria-label', 'Message the agent')
    input.placeholder = 'Ask for a change, or paste the paragraph to work on'
    input.value = draft
    input.addEventListener('input', () => {
      draft = input.value
      send.disabled = !canSend()
    })

    const configured = options.isConfigured()

    const send = document.createElement('button')
    send.type = 'submit'
    send.className = 'sm-agent-send'
    send.dataset['action'] = 'send'
    // The button says what pressing it will do, so the two modes cannot be
    // conflated by a reader who forgot which one is selected.
    send.textContent = MODE_LABEL[mode]

    const canSend = (): boolean => configured && draft.trim() !== ''
    send.disabled = !canSend()

    composer.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!canSend()) return
      const markdown = draft.trim()
      draft = ''
      options.onSend(mode, markdown)
      repaint()
    })

    composer.append(modes, hint, input, send)

    if (!configured) {
      // Loud and local. An unconfigured agent must not look like a working one
      // that had nothing to say.
      const missing = document.createElement('p')
      missing.className = 'sm-agent-unconfigured'
      missing.dataset['state'] = 'unconfigured'
      missing.textContent = 'No document agent is configured, so nothing can be sent.'
      const settings = document.createElement('button')
      settings.type = 'button'
      settings.dataset['action'] = 'open-settings'
      settings.textContent = 'Open Settings'
      settings.addEventListener('click', () => options.onOpenSettings())
      missing.append(settings)
      composer.append(missing)
    }

    return composer
  }

  function build(): HTMLElement {
    const panel = document.createElement('aside')
    panel.className = 'sm-agent-panel'
    // Not `dialog`: a dialog implies the document behind it is inert, and the
    // whole point is that the reader keeps reading while this is open.
    panel.setAttribute('role', 'complementary')
    panel.setAttribute('aria-label', 'Agent conversation')

    const header = document.createElement('header')
    header.className = 'sm-agent-panel-header'
    const title = document.createElement('span')
    title.className = 'sm-agent-panel-title'
    title.textContent = 'Agent'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'sm-agent-panel-close'
    close.dataset['action'] = 'close-panel'
    close.setAttribute('aria-label', 'Close agent conversation')
    close.innerHTML = tablerIcon('x')
    close.addEventListener('click', () => closePanel())
    header.append(title, close)
    // Every surface over the document accepts a drag (BUG-15 rule). A moved
    // panel becomes a floating window: app.css returns the column and the
    // notes to their docked places when `data-moved` is set.
    makeDraggable(panel)

    const list = document.createElement('div')
    list.className = 'sm-agent-messages'
    const messages = options.conversation.messages()
    if (messages.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'sm-agent-empty'
      empty.textContent = 'Nothing yet. Ask for a change to this note, or name another one.'
      list.append(empty)
    } else {
      for (const message of messages) list.append(messageElement(message))
    }
    if (question !== undefined) list.append(questionElement(question))

    panel.append(header, list, composerElement())
    return panel
  }

  function repaint(): void {
    if (!open) return
    // Keep the caret where the reader left it: a repaint caused by an arriving
    // agent message must not interrupt someone mid-word.
    const active = document.activeElement
    const wasComposing = active instanceof HTMLTextAreaElement
      && active.classList.contains('sm-agent-composer-input')
    const caret = wasComposing ? (active as HTMLTextAreaElement).selectionStart : null

    host.replaceChildren(build())

    if (!wasComposing || caret === null) return
    const input = host.querySelector<HTMLTextAreaElement>('.sm-agent-composer-input')
    if (input === null) return
    input.focus()
    input.setSelectionRange(caret, caret)
  }

  function openPanel(): void {
    if (open) return
    open = true
    host.replaceChildren(build())
    // The one place focus moves on its own, and only because the reader asked
    // for this surface.
    host.querySelector<HTMLTextAreaElement>('.sm-agent-composer-input')?.focus()
  }

  function closePanel(): void {
    if (!open) return
    open = false
    editing = undefined
    editingDraft = undefined
    editorFocused = false
    // Absent, not hidden: nothing named `sm-agent-panel` survives a close.
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
    refreshScope: () => {
      if (open) scopeChipPaint?.()
    },
    setQuestion: (next) => {
      question = next
      repaint()
    },
  }
}
