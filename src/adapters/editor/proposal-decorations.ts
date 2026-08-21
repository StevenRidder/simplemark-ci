import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * Proposal markup (AGENT-13, ADR-0013): Track Changes with the roles reversed.
 *
 * A pending proposal is drawn over the document without being in it — a
 * strikethrough over the passage it would replace and, right after it, the
 * proposed Markdown rendered through the document's own pipeline, with Accept
 * and Reject beside it. Decorations only: the serialised Markdown is
 * byte-identical with any number of proposals on screen, which is the whole
 * promise. Positions map through the person's own typing like every other
 * decoration; the caller recomputes them from the proposal's text whenever
 * it repaints.
 */

export interface ProposalDecorationItem {
  readonly id: string
  readonly name: string
  /** Document positions of the passage the proposal replaces; `from === to` for an insertion. */
  readonly from: number
  readonly to: number
  /** The proposed Markdown, already rendered. Cloned per paint. */
  readonly fragment: DocumentFragment
}

interface ProposalsState {
  readonly items: readonly ProposalDecorationItem[]
  readonly decorations: DecorationSet
}

export const proposalsKey = new PluginKey<ProposalsState>('simplemark-proposals')

function widgetFor(item: ProposalDecorationItem): HTMLElement {
  const host = document.createElement('span')
  host.className = 'sm-proposal-ins'
  host.dataset['proposal'] = item.id
  host.contentEditable = 'false'
  host.setAttribute('role', 'group')
  host.setAttribute('aria-label', `Proposed: ${item.name}`)

  const body = document.createElement('span')
  body.className = 'sm-proposal-ins-body'
  body.append(item.fragment.cloneNode(true))

  const actions = document.createElement('span')
  actions.className = 'sm-proposal-actions'
  for (const [action, label, title] of [
    ['accept-proposal', 'Accept', 'Put this change into the document.'],
    ['reject-proposal', 'Reject', 'Drop this proposal. The document stays as it is.'],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['action'] = action
    button.dataset['proposal'] = item.id
    button.textContent = label
    button.title = title
    actions.append(button)
  }

  host.append(body, actions)
  return host
}

function decorate(doc: ProseNode, items: readonly ProposalDecorationItem[]): DecorationSet {
  const decorations: Decoration[] = []
  for (const item of items) {
    if (item.to > item.from) {
      decorations.push(
        Decoration.inline(item.from, item.to, {
          class: 'sm-proposal-del',
          'data-proposal': item.id,
        }),
      )
    }
    decorations.push(
      Decoration.widget(item.to, () => widgetFor(item), {
        side: 1,
        key: `proposal-${item.id}`,
        ignoreSelection: true,
        // The buttons are the widget's own; the editor must not turn their
        // clicks into selection changes.
        stopEvent: () => true,
      }),
    )
  }
  return DecorationSet.create(doc, decorations)
}

export function setProposals(view: EditorView, items: readonly ProposalDecorationItem[]): void {
  view.dispatch(view.state.tr.setMeta(proposalsKey, items))
}

function proposalsProsePlugin(): Plugin<ProposalsState> {
  return new Plugin<ProposalsState>({
    key: proposalsKey,
    state: {
      init: () => ({ items: [], decorations: DecorationSet.empty }),
      apply: (tr: Transaction, value: ProposalsState, _old: EditorState, next: EditorState) => {
        const meta = tr.getMeta(proposalsKey) as readonly ProposalDecorationItem[] | undefined
        if (meta !== undefined) return { items: meta, decorations: decorate(next.doc, meta) }
        if (tr.docChanged) return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) }
        return value
      },
    },
    props: {
      decorations(state) {
        return proposalsKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
  })
}

export const proposalsPlugin = $prose(() => proposalsProsePlugin())
