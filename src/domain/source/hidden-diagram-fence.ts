/**
 * A diagram fence that CommonMark swallowed as literal text.
 *
 * A closing fence may not carry an info string, so ```` ```mermaid ```` sitting
 * inside an already-open info-less block does not close it — it becomes content.
 * The diagram never becomes a node, so nothing renders and nothing errors: the
 * document is legal Markdown that silently means something the author did not
 * intend. That silence is the bug. There is no renderer error here to hang the
 * diagram block's existing "Fix it" affordance on, so the signal must come from
 * source instead.
 */

/** Languages worth reporting. A bare fence swallowing prose is noise; swallowing one of these is not. */
const DIAGRAM_LANGUAGES = ['mermaid', 'dot', 'graphviz', 'vega-lite', 'vegalite', 'svg'] as const

export interface HiddenDiagramFence {
  /** The language on the swallowed fence, lowercased. */
  readonly language: string
  /** 1-based line of the enclosing block's opening fence — the stray delimiter. */
  readonly startLine: number
  /** 1-based line of the enclosing block's closing fence, or the last line when unclosed. */
  readonly endLine: number
}

/** Up to 3 leading spaces, then a run of 3+ backticks or tildes, then the info string. */
const FENCE = /^ {0,3}((`{3,})|(~{3,}))(.*)$/

interface FenceLine {
  readonly marker: string
  readonly info: string
}

function fenceLine(line: string): FenceLine | undefined {
  const match = FENCE.exec(line)
  if (match === null) return undefined
  return { marker: match[1] ?? '', info: (match[4] ?? '').trim().toLowerCase() }
}

function isDiagramLanguage(info: string): boolean {
  return (DIAGRAM_LANGUAGES as readonly string[]).includes(info)
}

export interface HiddenDiagramScanOptions {
  /**
   * Also match a nesting whose outer fence is longer than the inner one.
   *
   * Off by default: that shape is how diagram source is quoted on purpose, and
   * flagging it would fire on every document that documents Markdown. Turned on
   * only when something outside the bytes — a paste that arrived with an
   * equal-length fence — already establishes the nesting was a mistake.
   */
  readonly includeLongerOuterFence?: boolean
}

/**
 * Scans Markdown source for diagram fences trapped inside an info-less block.
 *
 * A hand-rolled scanner rather than a parse: `domain` may not depend on a
 * parser, and the closing-fence rule this relies on is the whole point — the
 * detector has to model it directly to be worth trusting.
 */
export function findHiddenDiagramFences(
  markdown: string,
  options: HiddenDiagramScanOptions = {},
): readonly HiddenDiagramFence[] {
  const lines = markdown.split('\n')
  const found: HiddenDiagramFence[] = []

  let open: FenceLine | undefined
  let openLine = 0
  let swallowed: string | undefined

  const closes = (fence: FenceLine, opener: FenceLine): boolean =>
    fence.marker[0] === opener.marker[0] &&
    fence.marker.length >= opener.marker.length &&
    fence.info === ''

  lines.forEach((line, index) => {
    const fence = fenceLine(line)

    if (open === undefined) {
      if (fence !== undefined) {
        open = fence
        openLine = index + 1
        swallowed = undefined
      }
      return
    }

    if (closes(fence ?? { marker: '', info: 'x' }, open)) {
      if (swallowed !== undefined) {
        found.push({ language: swallowed, startLine: openLine, endLine: index + 1 })
      }
      open = undefined
      swallowed = undefined
      return
    }

    if (fence === undefined || open.info !== '' || swallowed !== undefined) return

    // Only an equal-length inner fence is a mistake. Deliberately quoting diagram
    // source uses a *longer* outer fence, and that document is exactly right.
    const lengthMatches =
      options.includeLongerOuterFence === true
        ? fence.marker.length <= open.marker.length
        : fence.marker.length === open.marker.length
    if (isDiagramLanguage(fence.info) && lengthMatches) {
      swallowed = fence.info
    }
  })

  if (open !== undefined && swallowed !== undefined) {
    found.push({ language: swallowed, startLine: openLine, endLine: lines.length })
  }

  return found
}
