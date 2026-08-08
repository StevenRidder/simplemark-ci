/**
 * Serializing a rendered figure for Copy image / Save image
 * (figure-viewer-everywhere spec §1 ruling 3).
 *
 * Every export starts from the drawing's own **natural size** — never the
 * viewer's zoom `scale`, never the block's committed `width=` — because an
 * export must not inherit how the person happened to be looking at the
 * figure when they asked for a copy. Rasterization always happens at 2× that
 * natural size, matching a Retina screenshot rather than a 1× thumbnail.
 */

/** CSS absolute lengths, in px — the units an svg's `width`/`height` attribute may carry. */
const CSS_UNITS: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
}

function parseLength(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const match = /^([\d.]+)\s*([a-z]*)$/i.exec(raw.trim())
  if (match === null) return undefined
  const value = Number(match[1])
  const scale = CSS_UNITS[(match[2] ?? '').toLowerCase() || 'px']
  return Number.isFinite(value) && value > 0 && scale !== undefined ? value * scale : undefined
}

/**
 * The drawing's own authored size, in CSS pixels — read from the live `svg`
 * node's `width`/`height` attributes, falling back to its `viewBox`. The
 * same two sources `naturalWidth()` (diagram-node-view.ts) and the figure
 * viewer's own sizing read, kept here as the one shared copy both the viewer
 * and the export path use.
 */
export function naturalSize(svg: SVGElement): { width: number; height: number } | undefined {
  const width = parseLength(svg.getAttribute('width'))
  const height = parseLength(svg.getAttribute('height'))
  if (width !== undefined && height !== undefined) return { width, height }

  const viewBox = svg.getAttribute('viewBox')
  if (viewBox === null) return undefined
  const parts = viewBox.split(/[\s,]+/).map(Number)
  const vbWidth = parts[2] ?? NaN
  const vbHeight = parts[3] ?? NaN
  if (!(Number.isFinite(vbWidth) && vbWidth > 0 && Number.isFinite(vbHeight) && vbHeight > 0)) return undefined
  if (width !== undefined) return { width, height: width * (vbHeight / vbWidth) }
  return { width: vbWidth, height: vbHeight }
}

export interface SerializedFigure {
  readonly svgText: string
  readonly width: number
  readonly height: number
}

/**
 * `svg`'s markup at natural size, self-contained (namespaced, sized) so it
 * decodes standalone whether it lands in an `<img>`, a canvas rasterization,
 * or a `.svg` file on disk. Any `<style>` the renderer already inlined
 * (Mermaid and Graphviz both do) travels with the clone untouched — that is
 * the font/style dependency the spec asks to be inlined, and it already is
 * by construction; nothing here needs to reach into computed styles.
 */
export function serializeSvgForExport(svg: SVGElement): SerializedFigure {
  const size = naturalSize(svg) ?? {
    width: svg.clientWidth || 300,
    height: svg.clientHeight || 150,
  }
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(size.width))
  clone.setAttribute('height', String(size.height))
  clone.style.removeProperty('width')
  clone.style.removeProperty('max-width')
  const svgText = new XMLSerializer().serializeToString(clone)
  return { svgText, width: size.width, height: size.height }
}

/** Every PNG export rasterizes at this multiple of the figure's natural size. */
export const EXPORT_SCALE = 2

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('Could not decode the figure for image export')))
    image.src = src
  })
}

/**
 * Rasterizes `svgText` (natural-size, self-contained per
 * `serializeSvgForExport`) to a PNG, at `EXPORT_SCALE`× — a canvas step, not
 * a screenshot, so the result is crisp on a Retina display rather than
 * upscaled after the fact.
 */
export async function rasterizeSvgToPng(figure: SerializedFigure): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(figure.width * EXPORT_SCALE))
  canvas.height = Math.max(1, Math.round(figure.height * EXPORT_SCALE))
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('Canvas 2D context unavailable for image export')

  const blob = new Blob([figure.svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(url)
  }

  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (pngBlob === null) throw new Error('Canvas produced no PNG data for image export')
  return new Uint8Array(await pngBlob.arrayBuffer())
}
