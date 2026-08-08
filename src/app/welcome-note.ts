/**
 * The note both shells open before you pick a real file.
 *
 * Shared rather than duplicated per entrypoint: the browser and native shells
 * are the same product (ADR-0001 §Web and native shells), so the first thing a
 * person sees must be the same document in both — a blank note, matching what
 * `createNote()` opens for a deliberately new file.
 */

export const WELCOME_NAME = 'Untitled.md'

export const WELCOME_MARKDOWN = '# \n'
