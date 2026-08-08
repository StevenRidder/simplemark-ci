# Turn a list item into a Paragraph — design

- **Status:** Approved design, ready for planning
- **Date:** 2026-08-08
- **Companion to:** [`commands.ts`](../../../src/application/commands.ts), [`milkdown-editor.ts`](../../../src/adapters/editor/milkdown-editor.ts), [`window-chrome.ts`](../../../src/app/ui/window-chrome.ts)

## 1. What this is

A new **Paragraph** command that converts the list item the cursor is in
back into a plain paragraph, removing it from its list(s) — regardless of
how deeply it's nested. Surfaced in two places: the styles bar's floating
**Lists** dropdown, and the native/web **Format** menu's Structure group,
next to Indent and Outdent.

Today there is no way to do this from the UI at all. The underlying
capability already half-exists by accident: `outdentListItem` (bound to
`liftListItemCommand` from `prosemirror-schema-list`) already turns a
**top-level, non-nested** list item into a paragraph and splits the list
around it, because `liftListItem` falls through to `liftOutOfList` when
there's no parent list to lift into. But that's an implementation detail of
Outdent, not a named, discoverable action, and it doesn't work for nested
items — outdenting those only moves them up one list level (`liftToOuterList`),
same as always.

## 2. Command

**Registry** (`commands.ts`): new entry `paragraph`, label **"Paragraph"**,
`target: 'editor'`, no accelerator. Added to the existing `Structure` group
in the Format menu, alongside indent/outdent:
`['indentListItem', 'outdentListItem', 'paragraph']`.

**Behavior** (`milkdown-editor.ts`): a new `case 'paragraph'` in the editor's
command switch. It repeatedly dispatches `liftListItemCommand` — the same
command Outdent already uses — for as long as the selection remains inside a
`list_item` node, stopping once it's not (bounded by the list's max nesting
depth, so a malformed/cyclic state can't loop forever). This reuses
`liftOutOfList`/`liftToOuterList` at each level rather than writing new
transaction logic:

- **Top-level item:** one lift, same effect as Outdent today — the list
  splits around it and it becomes a paragraph.
- **Nested item:** each lift moves it up one list level (mirroring what
  Outdent alone would do); the loop keeps going past what Outdent does today,
  until there's no enclosing list left.
- **Task-list item:** same lift path — it becomes a plain paragraph and loses
  its checkbox, consistent with what a full outdent-to-root would already do
  to a bullet/ordered item.

**Enablement:** enabled whenever the selection is inside any `list_item` —
the same gate `outdentListItem` already uses. Disabled otherwise.

## 3. Placement

- **Styles bar → Lists dropdown** (`window-chrome.ts`, `lists` menu): insert
  `command('Paragraph', 'paragraph')` immediately after `Outdent`, before
  `Block Quote` — keeps it grouped with the other structural
  indent/outdent/exit actions rather than mixed in with list-*type* choices
  (List, Ordered List) or the Todo/Callout submenus.
- **Format menu** (`commands.ts` menu grouping): appended to the existing
  `Structure` section (`['indentListItem', 'outdentListItem']` →
  `['indentListItem', 'outdentListItem', 'paragraph']`).

## 4. Out of scope

- Heading → paragraph conversion. No such command exists anywhere in the app
  today (headings only toggle via `wrapInHeadingCommand`); adding one is a
  separate gap for a later pass, not bundled into this change.
- Whole-list-at-once conversion (turning every item in a list into
  paragraphs in one action). This command only acts on the list item the
  cursor is currently in, matching how Indent/Outdent already scope to the
  current item.
- A keyboard shortcut/accelerator. Menu and styles-bar only for now.

## 5. Testing

| Test | Catches |
|---|---|
| `paragraph` on a top-level list item mid-list splits the list correctly around it and leaves a plain paragraph | core path, matches today's Outdent-at-root behavior |
| `paragraph` on an item nested two or more levels deep fully exits every enclosing list, not just one level | the actual new behavior vs. Outdent |
| `paragraph` on a task-list item drops the checkbox and produces a plain paragraph | task-list variant of the same node type |
| Command is disabled when the selection is not inside a list item | enablement gate |

Likely lives alongside the existing `indentListItem`/`outdentListItem` tests
in the editor's command test suite.

> **Planning-time correction (see the implementation plan's Global
> Constraints):** this codebase has no per-command dynamic enable/disable
> wiring for editor-target commands — `indentListItem`/`outdentListItem`
> render as always-enabled buttons and simply no-op when not applicable.
> `paragraph` follows the same pattern; the "Enablement" line above and the
> "disabled" test row do not apply as literal UI requirements.
