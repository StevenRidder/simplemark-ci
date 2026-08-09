import { history, redo, undo } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Step, Transform } from '@milkdown/kit/prose/transform'
import { EditorView } from '@milkdown/kit/prose/view'

import type { DiagramRenderer, RenderedDiagram } from '../../src/application/index.js'
import { DiagramNodeView } from '../../src/adapters/editor/diagram-node-view.js'
import { findKey, findProsePlugin } from '../../src/adapters/editor/find.js'
import { foldingProsePlugin } from '../../src/adapters/editor/folding.js'
import { InlineMathNodeView } from '../../src/adapters/editor/inline-math.js'
import { createAuthorityHarness, type AuthorityHarness } from './harness.js'

const FIXTURE = `# Authority

Introductory paragraph.

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

$$
E = mc^2
$$

Find the search target here.

| Name | Value |
| --- | --- |
| authority | five |

Read [[Roadmap|the roadmap]], =={green}important== details, and <u>underlined text</u>.
`

const REMOTE_META_KEY = 'simplemark-authority-remote'
const REMOTE_META_VALUE = 'authority-5-remote'
const remoteReceiptKey = new PluginKey<string | null>('authority-5-remote-receipt')

const remoteReceiptPlugin = new Plugin<string | null>({
  key: remoteReceiptKey,
  state: {
    init: () => null,
    apply: (transaction, prior) =>
      (transaction.getMeta(REMOTE_META_KEY) as string | undefined) ?? prior,
  },
})

interface TextRange {
  readonly from: number
  readonly to: number
}

interface MountedTarget {
  readonly harness: AuthorityHarness
  readonly mount: HTMLElement
  readonly view: EditorView
  applyRemote(
    base: ProseNode,
    stepsJson: readonly unknown[],
    committedStepsJson: readonly unknown[],
  ): { readonly accepted: boolean; readonly rebased: boolean }
  remoteReceipt(): string
  destroy(): Promise<void>
  lastDocumentText(): string
}

const renderer: DiagramRenderer = {
  languages: ['mermaid', 'math', 'math-inline'],
  async render(language: string, source: string): Promise<RenderedDiagram> {
    const escaped = `${language}:${source}`.replace(/[&<>]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
    })[character]!)
    return {
      ok: true,
      markup: `<svg viewBox="0 0 240 40" data-language="${language}"><text x="4" y="24">${escaped}</text></svg>`,
    }
  },
}

function textRange(doc: ProseNode, target: string): TextRange {
  let found: TextRange | undefined
  doc.descendants((node, position) => {
    if (found !== undefined || !node.isText || node.text === undefined) return found === undefined
    const offset = node.text.indexOf(target)
    if (offset !== -1) found = { from: position + offset, to: position + offset + target.length }
    return found === undefined
  })
  if (found === undefined) throw new Error(`Could not find ${target}`)
  return found
}

function insertStep(doc: ProseNode, position: number, text: string): readonly unknown[] {
  return new Transform(doc)
    .insert(position, doc.type.schema.text(text))
    .steps
    .map((step) => step.toJSON())
}

function withInlineMath(doc: ProseNode): ProseNode {
  const inlineMath = doc.type.schema.nodes['inline_math']
  if (inlineMath === undefined) throw new Error('Expected the production inline-math schema')
  const position = textRange(doc, ' search target').from
  return new Transform(doc).insert(position, inlineMath.create({ value: 'x^2' })).doc
}

async function mountTarget(): Promise<MountedTarget> {
  const harness = await createAuthorityHarness()
  const doc = withInlineMath(harness.parse(FIXTURE))
  const mount = document.createElement('div')
  mount.className = 'authority-mounted-editor'
  document.querySelector('#authority-harness')?.append(mount)

  const state = EditorState.create({
    doc,
    plugins: [history(), foldingProsePlugin(), findProsePlugin(), remoteReceiptPlugin],
  })
  const view = new EditorView(mount, {
    state,
    nodeViews: {
      code_block: (node, editorView, getPos) =>
        new DiagramNodeView(node, editorView, getPos, renderer),
      math_block: (node, editorView, getPos) =>
        new DiagramNodeView(node, editorView, getPos, renderer),
      inline_math: (node, editorView, getPos) =>
        new InlineMathNodeView(node, editorView, getPos, renderer),
    },
  })

  let destroyed = false
  let lastText = view.state.doc.textContent
  return {
    harness,
    mount,
    view,
    applyRemote: (base, stepsJson, committedStepsJson) => {
      if (destroyed || view.isDestroyed) return { accepted: false, rebased: false }
      const accepted = harness.rebase(base, stepsJson, committedStepsJson)
      if (!accepted.ok) return { accepted: false, rebased: false }

      let transaction = view.state.tr
      for (const stepJson of accepted.stepsJson) {
        transaction = transaction.step(Step.fromJSON(view.state.schema, stepJson))
      }
      if (!transaction.doc.eq(accepted.doc)) return { accepted: false, rebased: false }
      transaction.setMeta('addToHistory', false)
      transaction.setMeta(REMOTE_META_KEY, REMOTE_META_VALUE)
      view.dispatch(transaction)
      lastText = view.state.doc.textContent
      return { accepted: true, rebased: committedStepsJson.length > 0 }
    },
    remoteReceipt: () => remoteReceiptKey.getState(view.state) ?? '',
    destroy: async () => {
      if (destroyed) return
      lastText = view.state.doc.textContent
      destroyed = true
      view.destroy()
      mount.remove()
      await harness.destroy()
    },
    lastDocumentText: () => lastText,
  }
}

function nodeViewSnapshot(mount: HTMLElement): {
  readonly diagrams: number
  readonly inlineMath: number
  readonly foldChevrons: number
  readonly connected: boolean
} {
  const elements = [...mount.querySelectorAll('.diagram, .inline-math, .sm-fold-chevron')]
  return {
    diagrams: mount.querySelectorAll('.diagram').length,
    inlineMath: mount.querySelectorAll('.inline-math').length,
    foldChevrons: mount.querySelectorAll('.sm-fold-chevron').length,
    connected: elements.length > 0 && elements.every((element) => element.isConnected),
  }
}

async function mountedMapping(): Promise<{
  readonly before: ReturnType<typeof nodeViewSnapshot>
  readonly after: ReturnType<typeof nodeViewSnapshot>
  readonly sameNodeViews: boolean
  readonly rebased: boolean
  readonly remoteMeta: string
  readonly selectedText: string
  readonly decoratedText: string
  readonly documentText: string
}> {
  const target = await mountTarget()
  try {
    const base = target.view.state.doc
    const remoteSteps = insertStep(base, 1, 'remote prefix ')
    const humanPosition = textRange(base, 'Introductory paragraph.').to
    const humanTransaction = target.view.state.tr.insertText(' human local', humanPosition)
    const humanSteps = humanTransaction.steps.map((step) => step.toJSON())
    target.view.dispatch(humanTransaction)

    const range = textRange(target.view.state.doc, 'search target')
    target.view.dispatch(
      target.view.state.tr
        .setSelection(TextSelection.create(target.view.state.doc, range.from, range.to))
        .setMeta(findKey, { query: 'search target' }),
    )
    const beforeElements = [
      ...target.mount.querySelectorAll<HTMLElement>('.diagram, .inline-math'),
    ]
    const before = nodeViewSnapshot(target.mount)

    const remote = target.applyRemote(base, remoteSteps, humanSteps)
    if (!remote.accepted) throw new Error('Expected mounted target to accept remote step')

    const afterElements = [
      ...target.mount.querySelectorAll<HTMLElement>('.diagram, .inline-math'),
    ]
    const selectedText = target.view.state.doc.textBetween(
      target.view.state.selection.from,
      target.view.state.selection.to,
    )
    return {
      before,
      after: nodeViewSnapshot(target.mount),
      sameNodeViews: beforeElements.length === afterElements.length
        && beforeElements.every((element, index) => element === afterElements[index]),
      rebased: remote.rebased,
      remoteMeta: target.remoteReceipt(),
      selectedText,
      decoratedText: target.mount.querySelector('.sm-find-active')?.textContent ?? '',
      documentText: target.view.state.doc.textContent,
    }
  } finally {
    await target.destroy()
  }
}

async function undoIsolation(): Promise<{
  readonly afterHuman: string
  readonly afterRemote: string
  readonly afterUndo: string
  readonly afterRedo: string
  readonly undoApplied: boolean
  readonly redoApplied: boolean
  readonly remoteMeta: string
}> {
  const target = await mountTarget()
  try {
    const base = target.view.state.doc
    const remotePosition = textRange(base, 'search target').to
    const remoteSteps = insertStep(base, remotePosition, ' remote edit')
    const humanPosition = textRange(base, 'Introductory paragraph.').to
    const humanTransaction = target.view.state.tr.insertText(' human edit', humanPosition)
    const humanSteps = humanTransaction.steps.map((step) => step.toJSON())
    target.view.dispatch(humanTransaction)
    const afterHuman = target.view.state.doc.textContent

    if (!target.applyRemote(base, remoteSteps, humanSteps).accepted) {
      throw new Error('Expected mounted target to accept remote step')
    }
    const afterRemote = target.view.state.doc.textContent
    const undoApplied = undo(target.view.state, target.view.dispatch)
    const afterUndo = target.view.state.doc.textContent
    const redoApplied = redo(target.view.state, target.view.dispatch)
    return {
      afterHuman,
      afterRemote,
      afterUndo,
      afterRedo: target.view.state.doc.textContent,
      undoApplied,
      redoApplied,
      remoteMeta: target.remoteReceipt(),
    }
  } finally {
    await target.destroy()
  }
}

async function destroyedTarget(): Promise<{
  readonly accepted: boolean
  readonly beforeDestroy: string
  readonly afterAttempt: string
  readonly mountChildren: number
  readonly orphanedNodeViews: number
}> {
  const target = await mountTarget()
  const base = target.view.state.doc
  const lateStep = insertStep(base, 1, 'late remote ')
  const beforeDestroy = base.textContent
  await target.destroy()
  const accepted = target.applyRemote(base, lateStep, []).accepted
  return {
    accepted,
    beforeDestroy,
    afterAttempt: target.lastDocumentText(),
    mountChildren: document.querySelector('#authority-harness')?.childElementCount ?? -1,
    orphanedNodeViews: document.querySelectorAll(
      '.diagram-source-sheet, .authority-mounted-editor .diagram, .authority-mounted-editor .inline-math',
    ).length,
  }
}

declare global {
  interface Window {
    authoritySpike?: {
      mountedMapping: typeof mountedMapping
      undoIsolation: typeof undoIsolation
      destroyedTarget: typeof destroyedTarget
    }
  }
}

window.authoritySpike = { mountedMapping, undoIsolation, destroyedTarget }
