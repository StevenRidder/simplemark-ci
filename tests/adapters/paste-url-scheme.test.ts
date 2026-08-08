import { describe, expect, it } from 'vitest'

import { isRemoteImageSource } from '../../src/domain/index.js'
import { stripUnsafePastedUrls } from '../../src/adapters/editor/paste-urls.js'

/**
 * Issue #151, the adapter half: the tree walk that applies the domain
 * predicate to a parsed clipboard document.
 *
 * The vitest environment is deliberately `node` (ADR-0001), so this uses a
 * stand-in for the two element methods the walk touches. What it proves is the
 * *decision* — a refused destination loses only its attribute, and the element
 * carrying the text is never removed. That the selectors match real elements
 * is proven in a real browser by `tests/ui/article-capture.spec.ts`.
 */
interface FakeElement {
  attributes: Record<string, string>
}

function element(attributes: Record<string, string>): FakeElement {
  return { attributes }
}

function tree(anchors: FakeElement[], images: FakeElement[]) {
  const wrap = (found: FakeElement[]) =>
    found.map((node) => ({
      getAttribute: (name: string) => node.attributes[name] ?? null,
      removeAttribute: (name: string) => {
        delete node.attributes[name]
      },
    }))
  return {
    querySelectorAll: (selectors: string) => {
      if (selectors === 'a[href]') return wrap(anchors.filter((a) => 'href' in a.attributes))
      if (selectors === 'img[src]') return wrap(images.filter((i) => 'src' in i.attributes))
      throw new Error(`unexpected selector ${selectors}`)
    },
  }
}

describe('stripUnsafePastedUrls', () => {
  it('leaves an ordinary web link and an inline image untouched', () => {
    const anchor = element({ href: 'https://example.com/story', title: 'Story' })
    const image = element({ src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'A chart' })

    stripUnsafePastedUrls(tree([anchor], [image]))

    expect(anchor.attributes).toEqual({ href: 'https://example.com/story', title: 'Story' })
    expect(image.attributes['src']).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('drops a script destination and keeps everything else about the anchor', () => {
    const anchor = element({ href: 'javascript:alert(document.cookie)', title: 'Click me' })

    stripUnsafePastedUrls(tree([anchor], []))

    // The anchor itself survives, so ProseMirror parses its children as plain
    // text: the person keeps the words, loses only where they pointed.
    expect(anchor.attributes).toEqual({ title: 'Click me' })
  })

  it('drops a refused image source rather than the alt text beside it', () => {
    const image = element({ src: 'javascript:alert(1)', alt: 'A chart' })

    stripUnsafePastedUrls(tree([], [image]))

    expect(image.attributes).toEqual({ alt: 'A chart' })
  })

  /**
   * The fetch path is already closed by `isRemoteImageSource`, which
   * `remoteImageSources` gates on — asserted here rather than re-implemented,
   * because duplicating the guard is how the two drift apart.
   */
  it('cannot hand a refused scheme to the image-capture fetch path', () => {
    for (const src of ['javascript:alert(1)', 'data:text/html,<script></script>', 'file:///etc/passwd']) {
      expect(isRemoteImageSource(src), src).toBe(false)
    }
  })
})
