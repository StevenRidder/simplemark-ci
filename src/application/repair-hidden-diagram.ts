/**
 * The Markdown counterpart of the diagram block's "Fix it" loop.
 *
 * Same shape as `DiagramNodeView.#runFix`, deliberately: bounded attempts, an
 * immediate stop on a transport failure (which retrying cannot cure), and the
 * previous failure fed back into the next attempt. The difference is only what
 * counts as evidence — a renderer error there, a structural mismatch here.
 */

import {
  applyHiddenDiagramFix,
  describeHiddenDiagramFence,
  findHiddenDiagramFences,
} from '../domain/index.js'
import type { HiddenDiagramFixResult, HiddenDiagramScanOptions } from '../domain/index.js'
import type { DiagramFixPort } from './ports.js'

export const MAX_HIDDEN_DIAGRAM_FIX_ATTEMPTS = 3

export async function repairHiddenDiagram(
  markdown: string,
  port: DiagramFixPort,
  options: HiddenDiagramScanOptions = {},
): Promise<HiddenDiagramFixResult> {
  const fence = findHiddenDiagramFences(markdown, options)[0]
  if (fence === undefined) return { ok: false, message: 'No hidden diagram fence to fix.' }

  let complaint = describeHiddenDiagramFence(markdown, fence)
  let lastMessage = 'The correction could not be applied.'

  for (let attempt = 1; attempt <= MAX_HIDDEN_DIAGRAM_FIX_ATTEMPTS; attempt += 1) {
    const outcome = await port.fixMarkdown(complaint)
    // A transport or auth failure is not something a further attempt can fix.
    if (!outcome.ok) return { ok: false, message: outcome.message }

    const applied = applyHiddenDiagramFix(markdown, fence, outcome.source, options)
    if (applied.ok) return applied

    lastMessage = applied.message
    complaint = [complaint, '', `Your previous answer was rejected: ${applied.message}`].join('\n')
  }

  return { ok: false, message: lastMessage }
}
