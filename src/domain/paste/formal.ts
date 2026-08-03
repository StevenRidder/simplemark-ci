/**
 * DESIGN.md §4.2 signatures for the formal-notation tier: Graphviz DOT and
 * LaTeX math (RENDERERS.md §2, the "verified" and "core" rows).
 *
 * Both are agent-authorable text formats, which is why they belong in the
 * magic-paste set at all: an agent can write them fluently and a human can
 * read them in a diff.
 */

/**
 * Graphviz DOT: an optional `strict`, then `graph`/`digraph`, an optional name,
 * then a brace — and a closing brace somewhere after it.
 *
 * The brace is what separates DOT from Mermaid, whose `graph LR` shares the
 * keyword. Requiring the closing brace too keeps a half-pasted graph from
 * claiming the event and rendering an error card instead of falling through to
 * ordinary text.
 */
const DOT_SIGNATURE = /^\s*(strict\s+)?(di)?graph\b[^{]*\{/i

export function looksLikeDot(text: string): boolean {
  if (!DOT_SIGNATURE.test(text)) return false
  return text.includes('}')
}

/**
 * Display math: a `$$…$$` block, or a bare LaTeX environment.
 *
 * Deliberately narrow. Inline `$x$` is not claimed — a paste is a block-level
 * event, and single dollars are far more often money than math. `$$` at the
 * start with `$$` at the end is unambiguous; so is `\begin{env}…\end{env}`.
 */
const LATEX_ENVIRONMENT = /^\s*\\begin\{([a-z*]+)\}[\s\S]*\\end\{\1\}\s*$/i

export function looksLikeMath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) return true
  return LATEX_ENVIRONMENT.test(trimmed)
}

/** Removes `$$` fencing so the stored source is the expression itself. */
export function stripMathDelimiters(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
    return trimmed.slice(2, -2).trim()
  }
  return trimmed
}
