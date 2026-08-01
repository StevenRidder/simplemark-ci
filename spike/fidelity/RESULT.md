# Fidelity spike — result

- **Verdict:** **PASS, conditional.** Keep Milkdown. The untouched-save contract
  is met in full. The edited-block path needs one change the spike identified
  precisely, and that change layers on top of Milkdown rather than replacing it.
- **Date:** 2026-08-02
- **Task:** FIDELITY-1
- **Question (DESIGN.md §12):** can Milkdown be extended to satisfy D7 — preserve
  untouched source byte-for-byte while normalizing only edited blocks — or does
  the document model have to be built directly on ProseMirror with a
  source-mapping layer?

---

## Answer in one paragraph

Milkdown, unmodified, reproduces **1 of 10** hostile fixtures unchanged on an
untouched save. That is not a defect in Milkdown; it is what a general Markdown
serializer does, exactly as §12 predicted. But fidelity was never going to be a
property of the serializer. Adding a source map that re-emits untouched blocks
from their original bytes takes untouched save to **10 of 10**, byte-identical,
by construction. The editor choice therefore survives. What does **not** survive
is locating an edited block by its index, and that is the one real finding here.

---

## Method

Fixtures are the ten from `DESIGN.md` §12, committed under `tests/fixtures/`.
Each is loaded through the **real editor bridge** — the same `MilkdownEditor`
the product mounts, via `MilkdownEditor.serialize()` — in a Chromium page served
by the same Vite build. No reimplemented serializer, no mock.

Harness: `spike/fidelity/harness.ts`, driven by Playwright.

---

## Test 1 — untouched open → save

| Approach | Result |
|---|---|
| Milkdown alone | **1 / 10** byte-identical |
| Milkdown + source map | **10 / 10** byte-identical |

Baseline failures, and the §12 normalization each one is:

| Fixture | First divergence | Normalization |
|---|---|---|
| 01 borrowing map | byte 125 | `- ` → `* ` bullet marker |
| 02 front matter | byte 0 | `---` → `***`; **front matter is not a node at all** |
| 03 embedded HTML | — | identical (opaque HTML already preserved) |
| 04 mixed markers | byte 33 | `- ` → `* ` |
| 05 ragged tables | byte 91 | cell re-padding |
| 06 reference links | byte 228 | reference links inlined |
| 07 unusual fences | byte 60 | `~~~` → ` ``` ` |
| 08 mermaid + bare | byte 526 | indentation stripped |
| 09 byte hostility | byte 68 | trailing spaces → `\` hard break |
| 10 external edit | byte 0 | `---` → `***` |

Two of these are **data loss, not restyling**: front matter stops being front
matter (02, 10), and reference-link definitions are destroyed (06).

## Test 2 — edit one block, everything else byte-identical

Every block of every fixture was edited in turn — 113 single-block edits — and
the bytes outside that block's span compared against the original.

**10 / 10 fixtures, all 113 edits: no bleed.**

This is partly true by construction: the map tiles the file, so replacing one
span cannot disturb its neighbours. What the test genuinely proves is that the
tiling is correct — no gaps, no overlaps, no off-by-one — which is the part that
would silently corrupt documents if wrong.

## Test 3 — the one that mattered

Serializing an edited block **in isolation** is destructive, because a block's
meaning can depend on the rest of the document:

| Fixture 06, block | Original | Serialized alone |
|---|---|---|
| 2 | `See the [Peritext research][peritext] for why…` | `See the \[Peritext research]\[peritext] for why…` |
| 3 | `[peritext]: https://www.inkandswitch.com/peritext/ "…"` | `""` — **deleted** |

The reference link is escaped into literal text because its definition is not in
the slice; the definition block serializes to nothing because nothing in the
slice references it. Fixture 02 shows the same class of failure in front matter:
`aliases: []` → `aliases: \[]`.

Fix: serialize the **whole** document, then extract only the edited block from
that output. Re-measured: **no destroyed blocks, 10 / 10.**

## The boundary this spike exists to find

Extracting "block *k*" from the whole-document serialization assumes block *k*
means the same thing on both sides. It does not:

```
06-reference-links-footnotes.md   13 blocks  →  9 blocks
```

remark **drops** the four reference-link definitions when it serializes, because
it has already inlined their references. Every block after the first definition
shifts index. Nine of ten fixtures align; this one does not, and one
counter-example is enough — index correspondence is unsound.

**This is the fallback boundary.** Not "Milkdown cannot do it," but "block
identity cannot be positional."

---

## Decision

**Keep Milkdown.** Do not rebuild the document model on raw ProseMirror.

The §12 fail condition was "rebuild the document model on ProseMirror with an
explicit source map, cost measured in weeks." That is not what the evidence
calls for. The untouched-save path — the load-bearing half of D7, and the one
that protects documents nobody is editing — already passes at 10/10 with a
~90-line pure module. Replacing the bridge would not improve it.

What is required is narrower: **a stable block identity that survives
serialization.** Each top-level block gets an id at parse time, carried on the
ProseMirror node, so an edited block is located in the serialized output by id
rather than by position. That is a source-mapping layer *on* Milkdown, which is
what §12's D3 note anticipated when it said the choice is "Milkdown vs.
hand-rolled source-preserving model, and both are ProseMirror underneath, so
schema and NodeViews port either way." The schema, NodeViews, UI, and
application modules built in EDITOR-1 and PASTE-1 all survive unchanged.

### Required before an edited-block save touches a real file

1. **Stable block identity.** Id assigned at parse, carried on the node, used to
   locate the block in the serialized output. Index mapping must not ship.
2. **`remark-frontmatter`.** Front matter is currently parsed as a thematic
   break plus paragraphs. `---` serializes to `***` and YAML gets escaped. Until
   this lands, editing a note with front matter corrupts it.
3. **Reference-definition preservation.** remark inlines references and drops
   definitions. Any document using them loses author intent on the first edited
   save. Needs a serializer option or a preserved-node strategy.
4. **CRLF.** Line endings are normalized document-wide, so an edited block in a
   CRLF file silently converts. Fixture 09 covers it.

Items 2–4 only bite when a block is dirty; item 1 gates all of them.

### What is safe to build now

Everything that does not write an edited block to a real file. The untouched
path is proven, and `FixtureFilePort` still gates real files, so APP-1 can
proceed to the File System Access port on the *untouched* contract while item 1
lands alongside it.

---

## Versions

Measured with, exactly:

```
node                       v25.8.0
@milkdown/kit              7.21.3
prosemirror-model          1.25.11
prosemirror-state          1.4.4
prosemirror-view           1.42.2
remark-parse               11.0.0
remark-stringify           11.0.0
unified                    11.0.5
mdast-util-from-markdown   2.0.3
typescript                 5.9.3
vite                       7.x (see package-lock.json)
vitest                     3.2.7
@playwright/test           1.62.1
```

## Unresolved fidelity risks

- **Block identity is unproven end to end.** The spike measured the mapping's
  failure; it did not build the replacement. Until it exists, the edited-block
  path is theory.
- **The editor's dirty set is untested.** This spike marks blocks dirty from the
  outside. Whether ProseMirror's notion of "which top-level node changed"
  matches the source map's blocks — through splits, joins, and list surgery — is
  not measured here.
- **`emitDocument` trusts its offsets.** It is pure and covered, but a wrong
  block start from the parser produces a confidently wrong document. The tiling
  invariant (spans reconstruct the source exactly) is the guard and is asserted.
- **Fixture 03 passing unchanged even without the map** means opaque HTML was
  never at risk; it is the weakest fixture in the corpus and proves the least.
