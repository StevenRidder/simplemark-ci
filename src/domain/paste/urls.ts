/**
 * Which destinations a paste may write into the person's Markdown file.
 *
 * ProseMirror's schema parse already drops `<script>` and event-handler
 * attributes, so the remaining injection surface is the destination itself:
 * Milkdown's `link` mark takes its `href` verbatim, and `<img src>` feeds the
 * image-capture path. A page can author `<a href="javascript:…">` and — with
 * nothing here — that string becomes a Markdown link on disk.
 *
 * The link allow-list starts from the one the app already enforces at click
 * time: `resolve_document_link` (src-tauri/src/lib.rs) admits `http`, `https`,
 * `mailto` and note-relative paths, refuses `file:` as "tied to one machine",
 * and refuses every other scheme by name; `BrowserDocumentLinkPort` makes the
 * same choice. `file:` is therefore refused here too — a pasted `file:` href
 * is already a destination no shell in this app will open, so keeping it puts
 * a dead, machine-specific string in a portable file and buys nothing.
 *
 * `tel:` is the one addition, and it is deliberate. The realistic failure of a
 * rule like this is over-strictness, and a phone link is the most common
 * non-web scheme on a real page; it cannot execute code or reach the disk, and
 * Milkdown's own `sanitizeLinkHref` already treats it as safe. SimpleMark
 * cannot dial it, but the Markdown file outlives this app and the destination
 * is the person's data. Everything past that — `javascript:`, `vbscript:`,
 * `data:`, and any private application scheme — loses only the destination.
 *
 * That last group is the known cost of an allow-list: a `slack://` or
 * `zoommtg://` link pasted from an intranet page keeps its words and loses
 * where it pointed. It is accepted rather than overlooked. Only an allow-list
 * stays safe against a spelling nobody has thought of yet, the loss is bounded
 * to a destination, and nothing that worked inside SimpleMark stops working —
 * the click-time resolver already refuses every one of those schemes by name.
 * Admitting one that turns up in practice is a single entry below.
 *
 * Images get their own list because their risk and their usage differ: an
 * inline `data:image/...` is ordinary in clipboard HTML and the packaged
 * policy already loads it (`img-src 'self' data: blob: asset:`), while
 * `mailto:` is meaningless for a picture. Refusing inline images would delete
 * pictures that render today.
 *
 * Pure and DOM-free by ADR-0001 — the caller owns the tree walk. Rejection
 * removes only the destination; the visible text is never the predicate's to
 * touch.
 */

/** Schemes a link may keep: what a shell will open, plus the inert `tel:`. */
const LINK_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel'])

/** Schemes an image may keep by name. `data:` is admitted separately, by type. */
const IMAGE_SCHEMES: ReadonlySet<string> = new Set(['http', 'https'])

/** Tab, CR and LF, which a browser ignores anywhere inside a URL. */
const IGNORED_ANYWHERE = /[\t\n\r]/g

/** The last code point a browser strips from either end before parsing: space. */
const LAST_STRIPPED_CODE_POINT = 0x20

/**
 * What a browser reads before deciding the scheme.
 *
 * Tab, carriage return and line feed are ignored *anywhere* inside a URL, and
 * every C0 control plus space is stripped from both ends — which is how
 * `java<TAB>script:` and `<SOH>javascript:` still execute. Normalising the
 * same way is what stops a spelling from being read as relative here and as
 * script by the window.
 */
function normalise(value: string): string {
  const collapsed = value.replace(IGNORED_ANYWHERE, '')
  let start = 0
  let end = collapsed.length
  while (start < end && collapsed.charCodeAt(start) <= LAST_STRIPPED_CODE_POINT) start += 1
  while (end > start && collapsed.charCodeAt(end - 1) <= LAST_STRIPPED_CODE_POINT) end -= 1
  return collapsed.slice(start, end)
}

/**
 * The scheme, lowercased, or `null` when the value carries none.
 *
 * RFC 3986's production, anchored: a scheme cannot contain `/`, so
 * `notes/10:30 standup.md` has none and stays a relative path, while
 * `javascript:alert(1)` has one.
 */
function schemeOf(value: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)
  return match === null ? null : match[1]!.toLowerCase()
}

/** Whether a pasted `<a href>` may keep its destination. */
export function isSafePastedLinkHref(href: string): boolean {
  const scheme = schemeOf(normalise(href))
  return scheme === null || LINK_SCHEMES.has(scheme)
}

/** Whether a pasted `<img src>` may keep its source. */
export function isSafePastedImageSrc(src: string): boolean {
  const candidate = normalise(src)
  const scheme = schemeOf(candidate)
  if (scheme === null || IMAGE_SCHEMES.has(scheme)) return true
  // An inline image, and only an image: `data:text/html` is a document, and a
  // typeless `data:,` payload is not a picture either.
  return /^data:image\/[A-Za-z0-9.+-]+[;,]/.test(candidate)
}
