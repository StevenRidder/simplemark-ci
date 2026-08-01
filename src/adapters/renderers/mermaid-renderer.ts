import mermaid from 'mermaid'

import type { DiagramRenderer, RenderedDiagram } from '../../application/index.js'

/**
 * Mermaid implementation of the DiagramRenderer port.
 *
 * `securityLevel: 'strict'` disables HTML labels, so diagram source cannot
 * inject markup into the document (DESIGN.md §7). Note content never issues
 * network requests, so `startOnLoad` stays off and rendering only ever happens
 * through this adapter.
 *
 * Every failure resolves as `{ ok: false }` rather than throwing: a diagram that
 * does not parse must render an inline error card carrying the parser's own
 * message, never a blank rectangle and never a crash that takes the document
 * with it (DESIGN.md §4.4, §9.1).
 */

/**
 * Mermaid resolves colours into the SVG at render time, so CSS custom
 * properties cannot cascade into a finished diagram. The palette is therefore
 * read from the live tokens and handed over as theme variables — that is what
 * keeps a diagram on warm paper in light mode and on dark paper in dark mode
 * instead of leaving a white diagram stranded on a dark page.
 */
function token(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** The token values the last initialise used, so a scheme change re-initialises. */
let initialisedSignature = ''

function ensureInitialised(): void {
  const paper = token('--paper', '#fffefa')
  const soft = token('--soft', '#f3f1ec')
  const line = token('--line', '#e8e5df')
  const ink = token('--ink', '#242321')
  const ink2 = token('--ink-2', '#696660')
  const signature = [paper, soft, line, ink, ink2].join('|')
  if (signature === initialisedSignature) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: token('--sans', 'sans-serif'),
    themeVariables: {
      background: soft,
      primaryColor: paper,
      primaryTextColor: ink,
      primaryBorderColor: line,
      secondaryColor: soft,
      tertiaryColor: soft,
      lineColor: ink2,
      textColor: ink,
      mainBkg: paper,
      nodeBorder: line,
      clusterBkg: soft,
      clusterBorder: line,
      edgeLabelBackground: paper,
      titleColor: ink,
    },
  })
  initialisedSignature = signature
}

let renderSequence = 0

export class MermaidRenderer implements DiagramRenderer {
  readonly languages = ['mermaid'] as const

  async render(language: string, source: string): Promise<RenderedDiagram> {
    if (!this.languages.includes(language as 'mermaid')) {
      return { ok: false, message: `MermaidRenderer cannot render "${language}"` }
    }

    const trimmed = source.trim()
    if (trimmed === '') {
      return { ok: false, message: 'Diagram source is empty' }
    }

    try {
      ensureInitialised()
      // parse() first so a syntax error is reported as a syntax error, before
      // render() has a chance to leave orphaned nodes in the document.
      await mermaid.parse(trimmed)
      const { svg } = await mermaid.render(`simplemark-diagram-${(renderSequence += 1)}`, trimmed)
      return { ok: true, svg }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
