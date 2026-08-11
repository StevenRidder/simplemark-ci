/**
 * Whether two parsed clipboard flavours carry the same readable content.
 *
 * Adapters parse `text/plain` as Markdown and `text/html` through the editor
 * schema before calling this rule. Comparing those parsed texts avoids
 * mistaking Markdown punctuation or a link destination for lost visible text,
 * while still failing closed when a host/parser returns only part of a rich
 * selection. Formatting is allowed to differ; words are not.
 */
export function pastedTextIsComplete(reference: string, candidate: string): boolean {
  return normaliseParsedText(candidate) === normaliseParsedText(reference)
}

/** Host serializers disagree about non-breaking and zero-width layout text. */
function normaliseParsedText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
}
