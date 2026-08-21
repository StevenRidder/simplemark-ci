/**
 * Block-level comparison of two Markdown texts (ADR-0014 §5).
 *
 * Good enough to answer "what moved between then and now": blocks are split on
 * blank lines, matched by a longest common subsequence, and reported in order
 * as kept, added, or removed. Deliberately not a word-level diff engine — the
 * question Compare answers is which paragraphs changed, and a paragraph is
 * the unit a person reads.
 *
 * Pure: strings in, a list out.
 */

export type BlockChangeKind = 'same' | 'added' | 'removed'

export interface BlockChange {
  readonly kind: BlockChangeKind
  readonly text: string
}

function blocksOf(markdown: string): string[] {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
}

/** Longest common subsequence over blocks, then a walk that emits the edit script. */
export function diffBlocks(before: string, after: string): readonly BlockChange[] {
  const a = blocksOf(before)
  const b = blocksOf(after)
  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1]! + 1
        : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!)
    }
  }

  const changes: BlockChange[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      changes.push({ kind: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      changes.push({ kind: 'removed', text: a[i]! })
      i += 1
    } else {
      changes.push({ kind: 'added', text: b[j]! })
      j += 1
    }
  }
  while (i < a.length) {
    changes.push({ kind: 'removed', text: a[i]! })
    i += 1
  }
  while (j < b.length) {
    changes.push({ kind: 'added', text: b[j]! })
    j += 1
  }
  return changes
}

/** How many blocks differ — the number a summary line can say. */
export function changedBlockCount(changes: readonly BlockChange[]): number {
  return changes.filter((change) => change.kind !== 'same').length
}
