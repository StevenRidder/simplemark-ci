import { isSafePastedImageSrc, isSafePastedLinkHref } from '../../domain/index.js'

/**
 * Applies the §7 scheme rules to a parsed clipboard document, before
 * ProseMirror reads it (issue #151).
 *
 * The DOM half of a judgement `domain/paste/urls.ts` owns: ADR-0001 keeps the
 * rule pure, and this is the only place that touches `querySelectorAll` and
 * `removeAttribute` for it.
 *
 * Only the attribute is removed, never the element. `link`'s parseDOM is
 * `a[href]` and `image`'s is `img[src]`, so an anchor stripped of its `href`
 * stops matching and its children parse as ordinary text — the §4.4 "never
 * lose the source" rule applied to the one thing the reader actually sees. An
 * `<img>` carries no text, so it simply stops being an image; its `alt` stays
 * on the element for anything that still looks.
 *
 * Structurally typed rather than taking `Element`, so the decision is testable
 * in the DOM-free `node` vitest environment. A real `body` satisfies it.
 */
interface DestinationHolder {
  getAttribute(name: string): string | null
  removeAttribute(name: string): void
}

interface ClipboardTree {
  querySelectorAll(selectors: string): Iterable<DestinationHolder>
}

export function stripUnsafePastedUrls(root: ClipboardTree): void {
  for (const anchor of root.querySelectorAll('a[href]')) {
    if (!isSafePastedLinkHref(anchor.getAttribute('href') ?? '')) anchor.removeAttribute('href')
  }
  for (const image of root.querySelectorAll('img[src]')) {
    if (!isSafePastedImageSrc(image.getAttribute('src') ?? '')) image.removeAttribute('src')
  }
}
