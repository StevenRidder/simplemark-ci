import { fromMarkdown } from 'mdast-util-from-markdown'

import { MilkdownEditor } from '../../src/adapters/editor/milkdown-editor.js'
import { buildSourceMap, emitDocument } from '../../src/domain/index.js'
import type { DiagramRenderer, RenderedDiagram } from '../../src/application/index.js'

/**
 * The §12 go/no-go harness.
 *
 * Loads a fixture through the *real* editor bridge — the same MilkdownEditor
 * the product mounts — and hands the serialised result back to the driver.
 * Deliberately disposable: DESIGN.md keeps the spike under `spike/` because it
 * produces a decision, not a module.
 *
 * The renderer is inert here. Diagram rendering is irrelevant to byte fidelity
 * and loading Mermaid would only slow every round trip down.
 */
const inertRenderer: DiagramRenderer = {
  languages: [],
  async render(): Promise<RenderedDiagram> {
    return { ok: false, message: 'rendering disabled in the fidelity harness' }
  },
}

async function roundTrip(markdown: string): Promise<string> {
  const mount = document.createElement('div')
  document.body.append(mount)
  const editor = await MilkdownEditor.mount({
    mount,
    initialMarkdown: markdown,
    renderer: inertRenderer,
    onMarkdownChanged: () => {},
  })
  const out = editor.serialize()
  await editor.destroy()
  mount.remove()
  return out
}

/** Top-level block offsets, straight from remark's own positions. */
function blockStarts(markdown: string): number[] {
  const tree = fromMarkdown(markdown)
  return tree.children
    .map((node) => node.position?.start.offset)
    .filter((offset): offset is number => offset !== undefined)
}

/**
 * The D7 path: parse once for offsets, then re-emit with only the named blocks
 * serialised. `dirtyIndexes` empty is the untouched-save case.
 */
async function preservingRoundTrip(markdown: string, dirtyIndexes: number[]): Promise<string> {
  const map = buildSourceMap(markdown, blockStarts(markdown))
  if (dirtyIndexes.length === 0) return emitDocument(map, new Map())

  // Serialise the WHOLE document, then take only the edited block out of it.
  //
  // Serialising a block in isolation destroys anything that depends on document
  // context: a reference link becomes escaped literal text because its
  // definition is not in the slice, and a definition block serialises to the
  // empty string because nothing references it. Measured on fixture 06.
  const whole = await roundTrip(markdown)
  const wholeMap = buildSourceMap(whole, blockStarts(whole))

  const dirty = new Map<number, string>()
  for (const index of dirtyIndexes) {
    if (map.blocks[index] === undefined) continue
    const replacement = wholeMap.blocks[index]
    if (replacement === undefined) continue
    dirty.set(index, whole.slice(replacement.contentStart, replacement.contentEnd))
  }
  return emitDocument(map, dirty)
}

declare global {
  interface Window {
    fidelity?: {
      roundTrip(markdown: string): Promise<string>
      preservingRoundTrip(markdown: string, dirtyIndexes: number[]): Promise<string>
      blockCount(markdown: string): number
      spans(markdown: string): { contentStart: number; contentEnd: number; separatorEnd: number }[]
    }
  }
}

window.fidelity = {
  roundTrip,
  preservingRoundTrip,
  blockCount: (markdown: string) => blockStarts(markdown).length,
  /** Exposes the tiling so the driver can check bleed against real spans. */
  spans: (markdown: string) =>
    buildSourceMap(markdown, blockStarts(markdown)).blocks.map((b) => ({
      contentStart: b.contentStart,
      contentEnd: b.contentEnd,
      separatorEnd: b.separatorEnd,
    })),
}
