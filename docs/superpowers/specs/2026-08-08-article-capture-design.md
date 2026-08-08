# Article capture — pasted web articles become real Markdown — design

- **Status:** Approved design, ready for planning.
- **Date:** 2026-08-08
- **Scope:** Two independent additions to the rich-HTML paste path: remote images become local files, and a full web page can be trimmed to its article on request.
- **Companion to:** [`DESIGN.md`](../../DESIGN.md) §4 (paste pipeline), §4.3 (reversibility), §4.4 (the three rules), §5 (portability tiers), §7 (security)
- **Changes:** two rows of the `DESIGN.md` §4.2 ruling table (§5 below); a new ADR-0008 for the network policy; the `src-tauri/capabilities/default.json` description
- **Depends on:** nothing. Both halves are independent of each other and can land in either order.

## 1. What this is

Pasting a Substack article into SimpleMark today produces Markdown that is structurally right and practically broken.

Two defects, measured on `https://newsletter.semianalysis.com/p/gemini-is-cooked-but-gcp-is-cooking` (219,824 bytes of HTML, 12 `<figure>` elements, 2 tables, 7 `<h2>`):

1. **Every image is a remote URL.** The HTML path keeps `<img src="https://substackcdn.com/…">` verbatim and the serializer writes `![](https://substackcdn.com/…)` into the `.md` file. In the packaged app that image never renders: the CSP is `img-src 'self' data: blob: asset: http://asset.localhost` ([`src-tauri/tauri.conf.json`](../../../src-tauri/tauri.conf.json)), so the reference resolves to nothing and [`asset-image-node-view.ts`](../../../src/adapters/editor/asset-image-node-view.ts) shows `File unavailable: https://…`. The note is also not portable: it depends on a CDN that can rewrite or expire the URL.
2. **The page furniture comes along.** Navigation, the subscribe form, the like/comment/share rows, the footer link farm and the logo alt-text runs are all document structure, so `htmlCarriesDocumentStructure` correctly routes them down the HTML path and ProseMirror faithfully turns them into headings, lists and links. The article is in there, wrapped in a few hundred lines of chrome.

This spec fixes both without changing what a paste means. The faithful paste still lands first, in one undoable step. Everything added here is either invisible (an image reference becoming local) or explicitly offered (trimming page chrome).

### 1.1 Why not a readability dependency

`@mozilla/readability` needs a live `Document`, which would put the rule in an adapter and outside the domain's reach, and it is tuned to *extract or fail* on a whole page rather than to prune a clipboard fragment conservatively. The rules here are a pure function over a DOM-free tree, testable with plain fixtures in the `node` vitest environment, and they only ever *remove* nodes the heuristic is confident about. No dependency is added.

## 2. Images become local files

### 2.1 The shape written to disk

A downloaded image is written beside the note and referenced with **standard relative Markdown**:

```markdown
![Gemini 3 benchmark scores](assets/3f9a1c2b7d4e5f60.png)
```

Not a wikilink. The `assets/` folder sits next to the `.md` file. The filename is the first 16 hex characters of the SHA-256 of the image bytes, plus an extension derived from the response `Content-Type`. Identical bytes therefore produce one file no matter how many notes or pastes reference them, and a second download of the same image is a no-op write.

This is exactly the reference form [`ports.ts`](../../../src/application/ports.ts) already requires of `AssetReference.src`: "deliberately the string written into Markdown, never a browser object URL, an absolute operating-system path, or an adapter-private id."

### 2.2 The port

```ts
/** An image stored beside the open note, as the reference written into Markdown. */
export interface StoredImage {
  /** Always a note-relative path such as `assets/3f9a1c2b7d4e5f60.png`. */
  readonly src: string
}

/** Bytes of a note-relative image, for display only — never written to Markdown. */
export interface LoadedImage {
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/**
 * Stores remote images beside the open note and reads them back for display.
 *
 * Absent in hosts that cannot write next to the document. A paste there keeps
 * the remote URL it arrived with, unchanged and visible.
 */
export interface ImageStorePort {
  /** Download `url` into the note's `assets/` folder. `null` = declined, keep the remote URL. */
  store(documentHandle: string, url: string): Promise<StoredImage | null>
  /** Read a note-relative image for rendering. `null` = not available. */
  read(documentHandle: string, href: string): Promise<LoadedImage | null>
}

/** The same capability with the open note already bound, as the editor sees it. */
export interface NoteImageStore {
  store(url: string): Promise<StoredImage | null>
  read(href: string): Promise<LoadedImage | null>
}
```

`store` and `read` sit on one port because they are one capability — "this host can keep images next to the note" — and a host that has one always has the other.

The port takes the document handle per call, exactly as [`DocumentLinkPort`](../../../src/application/ports.ts) does, and the composition root binds it with `session.documentHandle()` at call time — the same shape as the existing `onOpenLink` wiring in [`bootstrap.ts`](../../../src/app/bootstrap.ts). This deliberately avoids the `options.filePath` accessor `TauriChartDataReader` uses: that value is a display string such as `Not saved` in several app states, and a handle captured at startup would resolve against the wrong note after a navigation.

Adapters:

- **Native** (`src/adapters/filesystem/tauri-image-store.ts`): a thin transport, both methods invoking Rust commands with `{ documentHandle, url }` / `{ documentHandle, href }`.
- **Browser**: **no adapter and no port**. `AppPorts.images` is optional and `browser.ts` composes without it. A pasted article in the browser keeps its remote URLs and renders them normally, which is what a browser can honestly do.

### 2.3 Why the fetch is in Rust

The packaged app's `connect-src 'self' ipc: http://ipc.localhost` blocks a frontend `fetch` to any remote host, so the download must happen on the Rust side regardless. That is also the better place for it: no cookies are sent (`reqwest` has no cookie store configured), no CORS applies, and the same code can enforce a size cap and a scheme allowlist that a webview `fetch` could not.

### 2.4 The Rust command

`download_note_image(document_handle: String, url: String) -> Result<StoredImage, String>`

Refusals, each an ordinary `Err(String)` shown verbatim by the shell:

| Condition | Reason |
|---|---|
| Scheme is not `http` or `https` | `data:` and `blob:` sources are already local; anything else is not an image fetch |
| Host is a literal loopback or private address (`localhost`, `127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`) | Pasted HTML is untrusted input; it may not aim the app at the user's own network. A literal-address check, not DNS-resolution filtering — the limit is documented, not hidden |
| More than 4 redirects | Default is 10; an image does not need that many |
| Response larger than 24 MB | A note folder is not a download sink; the cap is checked against `Content-Length` and again while reading |
| `Content-Type` is not a supported raster image | See §2.5 |
| The note handle is not an existing file | There is no folder to write beside |

The write goes into `<note-dir>/assets/` and is skipped when a file with that content-hash name already exists. It is **not** a direct `create_new(true)` (the shape this spec originally proposed): the shipped code writes to a hidden temp file beside the destination, `fsync`s it, and renames it into place — the same pattern `save_note` in [`lib.rs`](../../../src-tauri/src/lib.rs) uses. The atomicity matters more here than for a note: a crash or power loss mid-write must not leave a truncated file under the final content-hash name, because the dedup check above would then treat that partial file as a complete download *forever* — identical bytes reuse the "existing" file rather than rewriting it, so no re-paste could ever repair it.

`read_note_asset(document_handle: String, href: String) -> Result<LoadedImage, String>` resolves `href` against the note directory, refuses any absolute path, scheme, `~`, or `..` segment — the rule `normaliseRelativeAssetPath` in [`browser-asset-reference-port.ts`](../../../src/adapters/filesystem/browser-asset-reference-port.ts) already states — and returns base64 bytes plus the media type inferred from the extension.

### 2.5 SVG keeps its remote URL

Supported: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`, `image/x-icon`, `image/tiff`. Extensions are mapped from a fixed table; no MIME crate is added.

`image/svg+xml` is **not** downloaded. §7 requires that "all SVG passes DOMPurify", and there is no sanitizer on the Rust side; writing unsanitised SVG into the user's own folder to satisfy a paste would be the kind of silent risk §4.4 exists to prevent. An SVG image keeps its remote URL — visible, unchanged, and exactly the state the paste arrived in.

### 2.6 How a stored image renders

`AssetImageNodeView` gains an optional `ImageStorePort`. Its resolution rule:

1. `src` is absolute (`http:`, `https:`, `data:`, `blob:`) → assign it directly, as today.
2. `src` is relative and no port is composed → assign it directly, as today. This is what keeps the browser suite's two existing assertions true: `public/assets/simplemark-asset.svg` still loads, and `assets/architecture.png` still shows `File unavailable:`.
3. `src` is relative and a port is composed → `read(href)`; on bytes, render through a `blob:` URL (already allowed by the CSP, and unlike `data:` it does not hold the whole image in a string); on `null` or a rejection, fall back to assigning `src` directly, which produces the existing visible `File unavailable:` state.

Every `blob:` URL is revoked in `update()` and `destroy()`.

This is the part that makes the feature true in the packaged app: **there is no working relative-image path there today**, so downloading without this would swap one blank image for another.

### 2.7 The rewrite is a separate transaction, outside history

The paste stays synchronous. `insertHtml` inserts the article with its remote `src` values, unchanged — a faithful paste, one undo step, exactly as now. Downloads start after that transaction and each result rewrites its own node:

- Nodes are found **by `src` value**, by scanning the current document, not by remembered positions. A rewrite that lands after the user has typed, reordered blocks, or accepted a trim still finds its image, and one that finds nothing does nothing. This is the same reasoning [`find.ts`](../../../src/adapters/editor/find.ts) records for recomputing rather than remapping.
- Each rewrite is dispatched with `addToHistory: false`. The download is a system edit, not a user edit; without this, ⌘Z would walk back through image rewrites one at a time instead of landing on the faithful paste.
- A failed or declined download does nothing at all. The remote URL stays, the image shows the existing `File unavailable:` state in the packaged app, and nothing is logged as success.
- Downloads are issued at most 4 at a time so a 40-image article does not open 40 sockets.

## 3. Trimming page chrome, on request

### 3.1 The offer

After a paste whose HTML looks like a full web page, a non-modal bar appears at the top of the pasted range:

```
Pasted a full page — trim page chrome?   [Trim]  [Dismiss]
```

It is a `Decoration.widget` anchored to the start of the pasted range, held in a plugin whose state is remapped through `tr.mapping.map` on every transaction and dropped when the range no longer maps — the pattern [`folding.ts`](../../../src/adapters/editor/folding.ts) already uses. It is dismissed by the Dismiss button, by Escape, or by accepting it. A subsequent paste does not dismiss it as such: only another *full-page* paste replaces it (with a fresh offer for the new range), while an ordinary paste leaves the offer up, remapped around the edit — unless that paste overwrites the offered range's own text, in which case the offer drops, like any edit that replaces what was pasted. It does not time out: DESIGN.md §4.3's "few seconds" fits a two-word affordance, not a decision that needs the article read first. It never blocks typing, and ignoring it entirely leaves the faithful paste.

This is the first implementation of the §4.3 ruling that "a *keep as plain text* affordance appears in the block corner"; the widget is built so that ruling can reuse it.

### 3.2 What "looks like a full web page" means

A pure domain predicate over a DOM-free tree (§3.4). True when either holds:

- **Role evidence** — the tree contains a `nav`, `footer`, `header`, or `aside` element, or an element whose `role` is `navigation`, `banner`, `contentinfo`, `complementary`, or `search`.
- **Density evidence** — an identifiable content core (§3.3) exists, and the material outside it contains at least 12 links and at least one block whose link density exceeds 0.5.

The thresholds are deliberately conservative: the cost of not offering is that the user trims by hand, and the cost of offering wrongly is a distracting bar on an ordinary paste.

Note the reference article has **zero** `nav`/`footer`/`header` elements — Substack builds its chrome from `div`s. Density evidence, not role evidence, is what carries that page, which is why both are required to be independently sufficient.

### 3.3 What trimming keeps

1. **Find the core.** The first `article`, `main`, or `[role=main]`; failing that, the element with the greatest total text length inside `p` descendants, requiring at least 400 characters. No core → no offer, and no trim.
2. **Keep the core's subtree**, minus the prunes below.
3. **Prune by role**: `nav`, `footer`, `header`, `aside`, `form`, `button`, `script`, `style`, `noscript`, `iframe`, and the ARIA roles listed in §3.2.
4. **Prune by link density**: a block whose links account for more than 0.5 of its text, or which is nothing but links and whitespace, and which contains no heading, table, image, or paragraph over 120 characters.
5. **Prune stranded footnote superscripts**: a `sup` whose only content is a link, when the paste contains no matching definition. Full footnote reconstruction is out of scope; a marker that points nowhere is page chrome.
6. **Never prune**: headings, paragraphs, lists, tables, images, figures, captions, blockquotes, code, or `pre`.

Headings, prose, lists, tables and images therefore survive; subscribe widgets, social rows, logo alt-text runs and footer link farms do not.

### 3.4 Where the rules live

The domain may not import a DOM — `.dependency-cruiser.cjs` blocks it and `vitest.config.ts` runs in `node` precisely to catch it. So the adapter converts and the domain decides:

```ts
/** A DOM-free mirror of a pasted element, built by the adapter. */
export interface PageNode {
  readonly id: number
  readonly tag: string
  readonly role?: string
  /** The element's `id` attribute — footnote definitions are found by anchor. */
  readonly domId?: string
  /** The element's `href` attribute — a stranded `sup` is one whose link points at no `domId` in the paste. */
  readonly href?: string
  readonly text: string
  readonly linkText: string
  readonly children: readonly PageNode[]
}

export interface PageAnalysis {
  /** Whether the paste looks like a full web page, i.e. whether to offer a trim. */
  readonly isFullPage: boolean
  /** The core's id, when one was identified. */
  readonly coreId?: number
  /** Ids to remove. Everything else under the core is kept. */
  readonly pruned: ReadonlySet<number>
}

export function analysePastedPage(root: PageNode): PageAnalysis
```

The adapter walks the parsed `Document` once to build `PageNode`s (keeping a parallel `id → Element` map), calls `analysePastedPage`, removes the pruned elements and everything outside the core from the real DOM, and re-parses the result through the existing `insertHtml` machinery. ProseMirror still does all HTML-to-document translation; nothing here reimplements it.

### 3.5 The provenance line

When the clipboard HTML carries a source URL, trimming prepends one line:

```markdown
> Source: [Gemini is Cooked but GCP is Cooking](https://newsletter.semianalysis.com/p/gemini-is-cooked-but-gcp-is-cooking)
```

- **URL** comes from the CF_HTML `SourceURL:` header or a `<base href>`, in that order. Nothing else. No `og:url`, no canonical link, no reconstruction from a CDN path.
- **Title** comes from `<title>` or `og:title`, trimmed. When the URL is present but no title is, the URL itself becomes the link text — `> Source: [https://…](https://…)` — never an invented title. One link shape rather than two keeps the provenance line on the same HTML-parsing path as the rest of the trimmed article.
- **When no URL is present, there is no line.** ADR-0006's rule that provenance is honest rather than uniform, and §4.4's "never guess silently wrong", both land on the same answer: an unknown source is written as nothing.

The reference article supplies `og:title` = `Gemini is Cooked but GCP is Cooking`, so a Chrome/Safari paste that carries a `SourceURL` header gets a complete line.

### 3.6 One undoable step

Accepting replaces the whole pasted range with the trimmed content plus the provenance line in a **single transaction**, dispatched through `closeHistory` so prosemirror-history cannot group it with the paste. The result:

- ⌘Z once → the faithful, untrimmed paste is back.
- ⌘Z twice → the document before the paste.

Declining, dismissing, or ignoring the offer leaves the faithful paste and costs one ⌘Z, exactly as today.

## 4. What must not regress

| Invariant | How this spec holds it |
|---|---|
| **BUG-1** — plain-text Markdown pastes as Markdown | Untouched. Nothing here runs unless the HTML path already claimed the paste. |
| **VS Code `<pre>` wrapper** | Untouched. `htmlCarriesDocumentStructure` is not modified. |
| **TSV tables**, **svg fences** | Untouched; both are decided before the HTML path is reached. |
| **D7** — untouched blocks byte-identical | No serializer change. Image rewrites and trims edit blocks, which makes exactly those blocks dirty — the Normalized tier, as designed. |
| **§4.4 never lose the source** | The faithful paste lands first and always survives; both features are additive and reversible. |
| **§4.4 fail visibly** | A failed download keeps a visible remote URL; a missing local file keeps `File unavailable:`. Neither silently becomes a blank. |
| **§7 no network from note content** | Note content still issues no requests. The download is one explicit, bounded, Rust-side fetch triggered by the person's own paste — see ADR-0008. |
| **ADR-0001 layering** | Extraction and provenance rules are pure domain; DOM work is `adapters/editor`; IO is `adapters/filesystem` plus Rust; the two adapters meet only through a port wired in `bootstrap.ts`. |
| **A feature may not work only in one shell** | The native shell stores and renders locally; the browser shell keeps working remote URLs and composes no port. Both are honest, neither is broken. |

## 5. The `DESIGN.md` §4.2 ruling table changes

Two rows are added after the existing `text/html` structure row:

| Case | Ruling |
|---|---|
| Clipboard `text/html` references remote images | **HTML path, then local.** The faithful paste lands with its remote URLs; each image is downloaded into `assets/` beside the note and its reference rewritten to `![alt](assets/<hash>.<ext>)` by a later transaction, outside undo history. A download that fails or is declined keeps the remote URL, visibly unchanged. |
| Clipboard `text/html` is a whole web page wrapped around an article | **HTML path, unchanged, plus an explicit offer.** A dismissible "trim page chrome?" bar appears; accepting replaces the pasted range in one undoable step with the extracted article, and a detected source URL is prepended as `> Source: …`. Never automatic, and declining leaves the faithful paste. |

## 6. Tests

**Domain (vitest, `node`).** `analysePastedPage` over hand-built `PageNode` fixtures: role evidence, density evidence, core selection and its 400-character floor, each prune rule, every "never prune" element, stranded-superscript removal, and the negative cases — an ordinary two-paragraph paste, a documentation page that is mostly links inside its core, a page with no identifiable core. Provenance parsing: `SourceURL:` header, `<base href>`, precedence, title fallbacks, entity decoding, a non-http URL being refused, and absence producing no line. Reference guards: `isRemoteImageSource` and `isPortableAssetReference`, which is what stops anything but a note-relative path reaching the document.

Media-type-to-extension mapping lives in Rust, where the `Content-Type` is, and is tested there rather than mirrored in TypeScript.

**Adapters (vitest).** `TauriImageStore` with an injected invoke, asserting the recorded calls and the late-bound handle. The src-keyed rewrite: a document where the image moved, one where it was deleted, one where the same URL appears twice. `AssetImageNodeView`'s three-branch resolution, including revocation of blob URLs.

**Rust (`npm run test:native`, proven locally — the Linux gate does not build the shell).** Content-hash naming and dedupe; the scheme, private-address, redirect, size and content-type refusals, each asserted as its own message; the `assets/` write path, including a `..` href and an absolute href being refused; `read_note_asset` round-tripping bytes. Downloads are served by a `TcpListener` fixture in-process; no network is touched.

**Playwright (`tests/ui/`).** A saved fixture of the reference article's clipboard HTML pasted into the harness: the trim offer appears; Dismiss leaves the faithful paste; Trim removes the chrome, keeps every heading, table and image, and prepends the source line; ⌘Z restores the faithful paste and a second ⌘Z clears it. An ordinary rich paste raises no offer. Images keep their remote URLs in the browser shell, unchanged and rendering. Per PR #137's lesson, each assertion is its own test rather than one reload-chained mega-test.

**§9.2 obligation.** Both new §4.2 rows get their sniffer-table test.

## 7. Out of scope

Footnote reconstruction; re-downloading images for notes pasted before this ships; a consent prompt or Allow/Ask/Block preference for image fetching (ADR-0008 records why the explicit paste gesture is the consent, and what would change that); garbage-collecting `assets/` files whose references were undone; `srcset`/`<picture>` resolution beyond the `src` ProseMirror already reads; and paywalled or login-gated pages, which paste as whatever the browser had.

### 7.1 Known limitation: redo reinstates remote references

Image rewrites are deliberately outside undo history, so undoing a paste and then **redoing** it restores the paste as it was captured — with its original remote URLs — while the download workers are long finished. Those images then show the ordinary `File unavailable:` state until the content is pasted again. The bytes are already on disk; only the references point away from them.

This is left as it is on purpose. The obvious fix — watching for any content that introduces remote image sources and capturing it — would also fire when a note is merely opened or reloaded from disk, which is precisely the automatic, unprompted fetching ADR-0008 declines to do. The narrower rule shipped here (capture on paste, and again when an accepted trim reinstates the pasted content) keeps every download attributable to a gesture the person actually made. A future fix must preserve that property rather than trade it away.
