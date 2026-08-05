/**
 * Paste-exhaust recognition — DESIGN.md §4.2 signatures for the output
 * formats of AI and terminal work: spreadsheet grids, diffs, ANSI captures,
 * JSON, file trees, stack traces.
 *
 * Same contract as recognition.ts: these are pure, cheap filters. A signature
 * hit is never a conversion by itself — the adapter validates first, and a
 * payload that fails validation takes the ordinary Markdown path (§4.4:
 * never guess silently wrong).
 */

/** A rectangular tab-separated grid — what Excel and Sheets put on the clipboard. */
/**
 * Markdown block structure — the mark of a document rather than exhaust.
 *
 * BUG-5: the tier below claims a paste that **is** a terminal artifact. A
 * document that merely quotes one is not that, and claiming it destroys the
 * whole paste — a long Markdown note whose ASCII diagram held four
 * box-drawing lines became a single `tree` card, headings and tables included.
 *
 * Deliberately narrow: a heading, a table row, or a fence. Prose is not on the
 * list, because terminal output regularly carries a sentence above it and that
 * paste should still convert (§4.4 — the cost of a wrong guess is a broken
 * block in the document).
 */
const MARKDOWN_BLOCK: readonly RegExp[] = [
  /^#{1,6}[ \t]\S/m,
  /^[ \t]*\|.*\|[ \t]*$/m,
  /^[ \t]*```/m,
]

export function looksLikeDocument(text: string): boolean {
  return MARKDOWN_BLOCK.some((pattern) => pattern.test(text))
}

/** Non-empty lines, the denominator for "is this mostly the artifact?". */
function significantLines(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length
}

export function looksLikeTsv(text: string): boolean {
  const lines = text.replace(/\n$/, '').split('\n')
  if (lines.length < 2) return false
  const tabs = lines[0]!.split('\t').length
  if (tabs < 2) return false
  return lines.every((line) => line.split('\t').length === tabs)
}

/** Converts a TSV grid to a GFM table, first row as header. */
export function tsvToMarkdownTable(text: string): string {
  const rows = text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => line.split('\t').map((cell) => cell.trim().replace(/\|/g, '\\|')))
  const header = rows[0]!
  const out = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ]
  return out.join('\n')
}

/** Unified diff: a git header, or at least one @@ hunk header. */
export function looksLikeDiff(text: string): boolean {
  if (looksLikeDocument(text)) return false
  return /^diff --git /m.test(text) || /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text)
}

/** ANSI SGR escape sequences — terminal output pasted raw. */
// eslint-disable-next-line no-control-regex
const ANSI_SGR = /\[[0-9;]*m/

export function looksLikeAnsi(text: string): boolean {
  if (looksLikeDocument(text)) return false
  return ANSI_SGR.test(text)
}

/** A parseable JSON object or array. Scalars are prose, not documents. */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  if (!/^[[{]/.test(trimmed)) return false
  try {
    const value: unknown = JSON.parse(trimmed)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}

/** Box-drawing tree listings, as `tree` and coding agents emit them. */
/**
 * A quarter of the content, so a couple of stray glyphs cannot claim a wall of
 * prose. A real tree is nearly all branches: the shallowest genuine paste in
 * the tests sits at 67%, the reported false positive at 19%.
 */
const TREE_DENSITY = 0.25

export function looksLikeFileTree(text: string): boolean {
  if (looksLikeDocument(text)) return false
  const decorated = text.split('\n').filter((line) => /[├└]──/.test(line))
  if (decorated.length < 2) return false
  const lines = significantLines(text)
  return lines > 0 && decorated.length / lines >= TREE_DENSITY
}

/** A JS `at fn (file:line:col)` stack or a Python traceback. */
export function looksLikeStackTrace(text: string): boolean {
  if (looksLikeDocument(text)) return false
  return (
    /^\s+at .+ \(?.+:\d+:\d+\)?$/m.test(text) ||
    /^Traceback \(most recent call last\):/m.test(text)
  )
}
