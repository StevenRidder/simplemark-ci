import { describe, expect, it } from 'vitest'

import { isSafePastedImageSrc, isSafePastedLinkHref } from '../../src/domain/index.js'

/**
 * Issue #151. Milkdown's `link` mark takes its destination verbatim, so a
 * page can author `<a href="javascript:…">` and the string lands in the
 * person's Markdown file. The predicate is the whole judgement; the adapter
 * only removes the attribute the predicate refuses.
 *
 * The allow-list starts from the one `resolve_document_link` already enforces
 * at click time (src-tauri/src/lib.rs) — `http`, `https`, `mailto`, or no
 * scheme at all — because keeping a destination the app would then refuse to
 * open is the worse answer of the two. `tel:` is added on top; see the test
 * that pins it.
 */
describe('pasted link destinations', () => {
  it('keeps the schemes the app can actually open', () => {
    for (const href of [
      'https://example.com/a?b=1#c',
      'http://example.com',
      'HTTPS://EXAMPLE.COM',
      'mailto:someone@example.com?subject=Hi',
    ]) {
      expect(isSafePastedLinkHref(href), href).toBe(true)
    }
  })

  /**
   * Not something this app can dial, and kept anyway. A phone link is the most
   * common non-web scheme on a real page, it cannot execute code or reach the
   * disk, and the Markdown file outlives SimpleMark — dropping it would be the
   * over-strictness this issue warns about, in the one place it is likeliest
   * to bite.
   */
  it('keeps a phone link, which is inert and ordinary on a real page', () => {
    expect(isSafePastedLinkHref('tel:+61-2-5550-1234')).toBe(true)
  })

  it('keeps every relative shape a note legitimately uses', () => {
    for (const href of [
      '#a-heading',
      './notes/other.md',
      '../assets/report.pdf',
      'other.md',
      'notes/10:30 standup.md',
      '?query=only',
      '/root-relative/page',
      '//example.com/protocol-relative',
      '',
      '   ',
    ]) {
      expect(isSafePastedLinkHref(href), href).toBe(true)
    }
  })

  it('refuses a script destination however it is spelled', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)',
      '\u0001javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\r\nscript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    ]) {
      expect(isSafePastedLinkHref(href), href).toBe(false)
    }
  })

  /**
   * `file:` is not legitimate note behaviour: `resolve_document_link` answers
   * "Absolute file links are tied to one machine; use a relative Markdown
   * path", and the browser shell's `DocumentLinkPort` refuses it too. A
   * pasted `file:` href is already a dead destination — dropping it keeps the
   * text and loses nothing that worked.
   */
  it('refuses a file: URL, which no shell will open', () => {
    expect(isSafePastedLinkHref('file:///device-root/secret.pdf')).toBe(false)
  })

  /**
   * The known, accepted cost of an allow-list, pinned so it is a decision
   * rather than an accident: a private application scheme loses its
   * destination. Only an allow-list stays safe against a scheme nobody has
   * thought of yet, and the loss is bounded — the words stay, and admitting a
   * scheme that turns up in practice is one entry in `LINK_SCHEMES`.
   */
  it('refuses a private application scheme, deliberately', () => {
    expect(isSafePastedLinkHref('slack://channel?team=T1&id=C1')).toBe(false)
  })
})

describe('pasted image sources', () => {
  it('keeps remote and relative sources', () => {
    for (const src of ['https://cdn.example.com/a.png', 'http://cdn.example.com/a.png', 'assets/a.png', '/logo.svg']) {
      expect(isSafePastedImageSrc(src), src).toBe(true)
    }
  })

  /**
   * Inline images are ordinary in clipboard HTML and the packaged policy
   * already admits them (`img-src 'self' data: blob: asset:`). Refusing them
   * would delete pictures that render today — the over-strictness this issue
   * warns about.
   */
  it('keeps an inline data: image, which the packaged policy already loads', () => {
    expect(isSafePastedImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isSafePastedImageSrc('data:image/svg+xml,%3Csvg%2F%3E')).toBe(true)
  })

  it('refuses a data: payload that is not an image, and every script scheme', () => {
    for (const src of [
      'data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=',
      'data:,plain',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ]) {
      expect(isSafePastedImageSrc(src), src).toBe(false)
    }
  })
})
