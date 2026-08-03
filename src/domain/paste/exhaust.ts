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
  return /^diff --git /m.test(text) || /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text)
}

/** ANSI SGR escape sequences — terminal output pasted raw. */
// eslint-disable-next-line no-control-regex
const ANSI_SGR = /\[[0-9;]*m/

export function looksLikeAnsi(text: string): boolean {
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
export function looksLikeFileTree(text: string): boolean {
  const decorated = text.split('\n').filter((line) => /[├└]──/.test(line))
  return decorated.length >= 2
}

/** A JS `at fn (file:line:col)` stack or a Python traceback. */
export function looksLikeStackTrace(text: string): boolean {
  return (
    /^\s+at .+ \(?.+:\d+:\d+\)?$/m.test(text) ||
    /^Traceback \(most recent call last\):/m.test(text)
  )
}
