/**
 * Document-level typography (DESIGN.md D6).
 *
 * > Per-selection font, size, and colour cannot be expressed in Markdown, so
 * > they do not exist. Bear works the same way: font family, size, line height,
 * > line width, and theme are preferences. The toolbar handles structure and
 * > emphasis only.
 *
 * These are app preferences, not document content: nothing here is ever written
 * to the `.md` file, and changing them cannot make a document dirty. That is the
 * whole reason this lives in `app` rather than `domain` — it is presentation
 * state, and the document does not know it exists.
 *
 * The Safari Reader model: choose a background, a face, and a size, and the
 * *whole* page follows.
 */

export const READER_THEMES = ['white', 'tan', 'black'] as const
export type ReaderTheme = (typeof READER_THEMES)[number]

/**
 * A curated set of text faces rather than a system font dump (§6).
 *
 * Serif first: long technical notes are read, and §10.4 puts serif body text at
 * the centre of the visual identity.
 */
export const FONT_FAMILIES = [
  {
    id: 'serif',
    label: 'Iowan',
    stack: "'Iowan Old Style', 'New York', Palatino, Georgia, serif",
  },
  {
    id: 'literata',
    label: 'Georgia',
    stack: "Georgia, 'Times New Roman', serif",
  },
  {
    id: 'sans',
    label: 'System',
    stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: "'SFMono-Regular', Consolas, monospace",
  },
] as const
export type FontFamilyId = (typeof FONT_FAMILIES)[number]['id']

/** Discrete steps, so "bigger" is repeatable and cannot drift to an odd value. */
export const TEXT_SCALES = [0.85, 0.925, 1, 1.1, 1.25, 1.4] as const
export type TextScale = (typeof TEXT_SCALES)[number]

export interface ReaderPreferences {
  readonly theme: ReaderTheme
  readonly family: FontFamilyId
  readonly scale: TextScale
}

/** The approved wireframe look (§10.4): warm paper, serif body, no zoom. */
export const DEFAULT_PREFERENCES: ReaderPreferences = {
  theme: 'tan',
  family: 'serif',
  scale: 1,
}

/** Steps to the next allowed size, clamping at both ends. */
export function nextScale(current: number, direction: 'up' | 'down'): TextScale {
  // Snap first: a stored or stale value that is not one of the steps still has
  // to move somewhere sensible rather than sticking.
  let nearest = 0
  for (let index = 1; index < TEXT_SCALES.length; index += 1) {
    if (Math.abs(TEXT_SCALES[index]! - current) < Math.abs(TEXT_SCALES[nearest]! - current)) {
      nearest = index
    }
  }
  const moved = direction === 'up' ? nearest + 1 : nearest - 1
  return TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, moved))]!
}

/**
 * Validates whatever came out of storage.
 *
 * Persisted preferences are untrusted input — a stale build, a hand-edited
 * localStorage, or a future version can all produce nonsense. An unreadable
 * page is a worse outcome than losing a preference, so anything unrecognised
 * falls back to the defaults wholesale rather than being partially repaired.
 */
export function normalisePreferences(value: unknown): ReaderPreferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES

  const candidate = value as Partial<Record<keyof ReaderPreferences, unknown>>
  const theme = candidate.theme
  const family = candidate.family
  const scale = candidate.scale

  const themeOk = READER_THEMES.some((known) => known === theme)
  const familyOk = FONT_FAMILIES.some((known) => known.id === family)
  const scaleOk = TEXT_SCALES.some((known) => known === scale)

  if (!themeOk || !familyOk || !scaleOk) return DEFAULT_PREFERENCES

  return { theme: theme as ReaderTheme, family: family as FontFamilyId, scale: scale as TextScale }
}

/** Resolves preferences to the CSS custom properties the stylesheet reads. */
export function preferenceVariables(preferences: ReaderPreferences): Record<string, string> {
  const family = FONT_FAMILIES.find((candidate) => candidate.id === preferences.family)
  return {
    '--reader-body': family?.stack ?? FONT_FAMILIES[0].stack,
    '--reader-scale': String(preferences.scale),
  }
}
