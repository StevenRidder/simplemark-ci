import type { SnapshotEntry, SnapshotStore } from '../../application/index.js'

const INDEX_PREFIX = 'simplemark.snapshots.'
const BYTES_PREFIX = 'simplemark.snapshot-bytes.'
/** Automatic snapshots kept per note; named ones are never pruned (ADR-0014 §3). */
export const AUTOMATIC_SNAPSHOT_LIMIT = 50

/**
 * Versions for hosts with no native snapshot port — the browser shell and its
 * tests. Same contract, same pruning rule, `localStorage` underneath; the
 * native shell never constructs it.
 */
export class LocalSnapshotStore implements SnapshotStore {
  #next = 1

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>,
  ) {}

  /** Forgets a key; a storage without removeItem blanks it, which reads as absent. */
  private forget(key: string): void {
    if (this.storage.removeItem !== undefined) this.storage.removeItem(key)
    else this.storage.setItem(key, '')
  }

  async list(noteKey: string): Promise<readonly SnapshotEntry[]> {
    return this.readIndex(noteKey)
  }

  async write(
    noteKey: string,
    markdown: string,
    options: { readonly trigger: SnapshotEntry['trigger']; readonly label?: string },
  ): Promise<SnapshotEntry> {
    const entry: SnapshotEntry = {
      id: `${Date.now().toString(36)}-${this.#next}`,
      createdMs: Date.now(),
      trigger: options.trigger,
      bytes: new TextEncoder().encode(markdown).length,
      ...(options.label === undefined ? {} : { label: options.label }),
    }
    this.#next += 1
    this.storage.setItem(`${BYTES_PREFIX}${noteKey}.${entry.id}`, markdown)
    const kept = prune([...this.readIndex(noteKey), entry])
    for (const dropped of this.readIndex(noteKey).filter((old) => !kept.some((k) => k.id === old.id))) {
      this.forget(`${BYTES_PREFIX}${noteKey}.${dropped.id}`)
    }
    this.storage.setItem(`${INDEX_PREFIX}${noteKey}`, JSON.stringify(kept))
    return entry
  }

  async read(noteKey: string, id: string): Promise<string> {
    const bytes = this.storage.getItem(`${BYTES_PREFIX}${noteKey}.${id}`)
    if (bytes === null || bytes === '') throw new Error('That snapshot no longer exists')
    return bytes
  }

  async remove(noteKey: string, id: string): Promise<void> {
    this.forget(`${BYTES_PREFIX}${noteKey}.${id}`)
    this.storage.setItem(
      `${INDEX_PREFIX}${noteKey}`,
      JSON.stringify(this.readIndex(noteKey).filter((entry) => entry.id !== id)),
    )
  }

  private readIndex(noteKey: string): SnapshotEntry[] {
    const raw = this.storage.getItem(`${INDEX_PREFIX}${noteKey}`)
    if (raw === null || raw === '') return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('The snapshot index could not be read')
    return parsed as SnapshotEntry[]
  }
}

/** Oldest-first; keeps every named snapshot and the newest automatic ones. */
export function prune(entries: readonly SnapshotEntry[]): SnapshotEntry[] {
  const automatic = entries.filter((entry) => entry.label === undefined)
  const drop = new Set(automatic.slice(0, Math.max(0, automatic.length - AUTOMATIC_SNAPSHOT_LIMIT)).map((e) => e.id))
  return entries.filter((entry) => !drop.has(entry.id))
}
