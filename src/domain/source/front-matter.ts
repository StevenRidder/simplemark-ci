/**
 * Closed YAML front matter, as a document prefix.
 *
 * A leading `---` is a fence only when a later line is a closing `---`.
 * A thematic break (`---\n\n# Title`) stays in the body.
 */

export interface SplitFrontMatter {
  readonly matter: string
  readonly body: string
}

export function splitClosedFrontMatter(source: string): SplitFrontMatter {
  if (!source.startsWith('---\n')) return { matter: '', body: source }

  const rest = source.slice(4)
  const close = rest.search(/\n---(?:\r?\n|$)/)
  if (close === -1) return { matter: '', body: source }

  let end = 4 + close + 4
  if (source.startsWith('\r\n', end)) end += 2
  else if (source[end] === '\n') end += 1

  if (source.startsWith('\r\n', end)) end += 2
  else if (source[end] === '\n') end += 1

  return { matter: source.slice(0, end), body: source.slice(end) }
}
