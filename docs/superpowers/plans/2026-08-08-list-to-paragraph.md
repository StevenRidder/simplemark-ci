# Turn a list item into a Paragraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Paragraph** command that turns the list item the cursor is in back into a plain paragraph, no matter how deeply it's nested, surfaced in the styles bar's Lists dropdown and the Format menu's Structure group.

**Architecture:** One new entry in the shared `DocumentCommandId` registry (`commands.ts`), dispatched through the existing `runCommand` switch in `bootstrap.ts` (already generic — no changes needed there) to a new `case 'paragraph'` in `MilkdownEditor.runCommand` (`milkdown-editor.ts`). The editor-side behavior loops the already-imported `liftListItemCommand` — the same primitive `outdentListItem` uses — until the selection is no longer inside a `list_item`, instead of lifting just one level. Surfaced in the styles bar's Lists dropdown (`window-chrome.ts`) next to Indent/Outdent.

**Tech Stack:** TypeScript (Vite, Vitest), Milkdown/ProseMirror (`liftListItemCommand` from `@milkdown/kit/preset/commonmark`), Playwright for UI behavior (this codebase has no unit-level tests for editor commands — all list-command coverage lives in `tests/ui/styles-bar.spec.ts` and drives the real editor).

## Global Constraints

- Every command in `COMMANDS` must appear in exactly one place in `MENUS` — enforced by `tests/application/commands.test.ts`'s `'gives every command a menu home'` and `'never shows the same command in two places'` tests.
- Command labels must not look like a camelCase id (`expect(COMMANDS[id].label).not.toMatch(/^[a-z]+[A-Z]/)`) — `'Paragraph'` already satisfies this.
- **No new accelerator.** Per the approved design, this command ships without a keyboard shortcut — do not add one to `commands.ts`.
- **Correction to the design doc's "Enablement" section:** this codebase has no per-command dynamic enable/disable wiring for editor-target commands. `commandButton` (`window-chrome.ts`, the `command = (...)` helper around line 636) always renders an editor command's button enabled — clicking it just calls the command, and the command itself is responsible for safely doing nothing if it doesn't apply. `indentListItem`/`outdentListItem` already work this way; `paragraph` must follow the same pattern, not introduce new disablement infrastructure.
- The ProseMirror node type for every kind of list item (bullet, ordered, task) is `'list_item'` — confirmed by the existing `toggleTaskList` method's own depth-walk (`milkdown-editor.ts:1223-1230`), which this task's new code mirrors.
- **Line numbers below are exact for this worktree's base commit** (branched fresh from `origin/main`, commit `0f3dd8f`). Every "Files:" line number and step points at that tree; if a prior task in this plan has already landed, re-check line numbers by searching for the surrounding code shown in each step rather than trusting the raw number, since earlier edits shift later ones.

---

### Task 1: Register the `paragraph` command

**Files:**
- Modify: `src/application/commands.ts:56` (add to `DocumentCommandId` union)
- Modify: `src/application/commands.ts:221` (add `COMMANDS` entry)
- Modify: `src/application/commands.ts:509` (add to the `Structure` menu group)
- Test: `tests/application/commands.test.ts` (new `it` block after the test ending at line 69)

**Interfaces:**
- Produces: `DocumentCommandId` now includes `'paragraph'`; `COMMANDS.paragraph` is `{ id: 'paragraph', label: 'Paragraph', target: 'editor' }`. Task 2 and Task 3 both consume this id by name.

- [ ] **Step 1: Write the failing registry test**

In `tests/application/commands.test.ts`, insert directly after the `'keeps the wireframe Format menu order: heading, emphasis, then blocks'` test (which ends at line 69, right before `'keeps the optional styles bar in View, not Format'`):

```ts
  it('adds Paragraph to the Structure group, alongside Indent and Outdent', () => {
    expect(COMMANDS.paragraph).toBeDefined()
    expect(COMMANDS.paragraph.label).toBe('Paragraph')
    expect(COMMANDS.paragraph.target).toBe('editor')

    const format = MENUS.find((menu) => menu.label === 'Format')!
    const structure = format.sections.flat().find(
      (entry): entry is { label: string; items: readonly DocumentCommandId[] } =>
        typeof entry === 'object' && entry.label === 'Structure',
    )!
    expect(structure.items).toEqual(['indentListItem', 'outdentListItem', 'paragraph'])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/application/commands.test.ts`
Expected: FAIL to compile — `COMMANDS.paragraph` does not exist on type `Record<DocumentCommandId, CommandDefinition>` because `'paragraph'` is not yet a member of `DocumentCommandId`.

- [ ] **Step 3: Add `'paragraph'` to the `DocumentCommandId` union**

In `src/application/commands.ts`, change:

```ts
  | 'indentListItem'
  | 'outdentListItem'
  | 'uppercase'
```

to:

```ts
  | 'indentListItem'
  | 'outdentListItem'
  | 'paragraph'
  | 'uppercase'
```

- [ ] **Step 4: Add the `COMMANDS.paragraph` definition**

Change:

```ts
  indentListItem: { id: 'indentListItem', label: 'Indent', target: 'editor', accelerator: 'CmdOrCtrl+BracketRight' },
  outdentListItem: { id: 'outdentListItem', label: 'Outdent', target: 'editor', accelerator: 'CmdOrCtrl+BracketLeft' },
  uppercase: { id: 'uppercase', label: 'Upper Case', target: 'editor' },
```

to:

```ts
  indentListItem: { id: 'indentListItem', label: 'Indent', target: 'editor', accelerator: 'CmdOrCtrl+BracketRight' },
  outdentListItem: { id: 'outdentListItem', label: 'Outdent', target: 'editor', accelerator: 'CmdOrCtrl+BracketLeft' },
  paragraph: { id: 'paragraph', label: 'Paragraph', target: 'editor' },
  uppercase: { id: 'uppercase', label: 'Upper Case', target: 'editor' },
```

- [ ] **Step 5: Add `paragraph` to the Structure menu group**

Change:

```ts
        { label: 'Structure', items: ['indentListItem', 'outdentListItem'] },
```

to:

```ts
        { label: 'Structure', items: ['indentListItem', 'outdentListItem', 'paragraph'] },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- tests/application/commands.test.ts`
Expected: PASS — every test in the file, including the new one and all pre-existing registry invariants (menu home, no duplicates, accelerator uniqueness, etc.).

- [ ] **Step 7: Commit**

```bash
git add src/application/commands.ts tests/application/commands.test.ts
git commit -m "feat: register Paragraph command in the Structure menu group"
```

---

### Task 2: Editor behavior — lift a list item fully out of every enclosing list

**Files:**
- Modify: `src/adapters/editor/milkdown-editor.ts:138` (add `'paragraph'` to `EditorCommandName`)
- Modify: `src/adapters/editor/milkdown-editor.ts:481` (add `case 'paragraph'` to the command switch)
- Modify: `src/adapters/editor/milkdown-editor.ts:1253` (add new private method `liftListItemToParagraph`)
- Test: `tests/ui/styles-bar.spec.ts` (new test after the test ending at line 181)

**Interfaces:**
- Consumes: `liftListItemCommand` and `callCommand` (already imported at the top of `milkdown-editor.ts`), `editorViewCtx` (already imported at the top) — no new imports.
- Consumes: `COMMANDS.paragraph` / `'paragraph'` id from Task 1.
- Produces: `MilkdownEditor.runCommand('paragraph')` — reachable directly in tests via `window.simplemark!.run('paragraph' as never)`, the same pattern `tests/ui/clipboard-exports.spec.ts` already uses for `'pasteAsPlainText'`. This does not require Task 3's UI wiring to be testable.

- [ ] **Step 1: Write the failing Playwright test**

In `tests/ui/styles-bar.spec.ts`, insert a new test directly after `'portable structure corrections survive as ordinary Markdown'` (which ends at line 181):

```ts
test('Paragraph lifts a list item out of every enclosing list, no matter how deep', async ({ page }) => {
  // A top-level item, mid-list: the list splits around it into two lists
  // with a bare paragraph in between.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('alpha')
  await page.evaluate(() => window.simplemark!.run('bulletList' as never))
  await page.keyboard.press('Enter')
  await page.keyboard.type('beta')
  await page.keyboard.press('Enter')
  await page.keyboard.type('gamma')
  await expect.poll(() => markdown(page)).toMatch(/[*-] alpha\n[*-] beta\n[*-] gamma/)

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowUp')
  await page.evaluate(() => window.simplemark!.run('paragraph' as never))
  await expect.poll(() => markdown(page)).toMatch(/[*-] alpha\n+beta\n+[*-] gamma/)

  // A nested item, two levels deep: fully exits every enclosing list, not
  // just one — unlike Outdent, which would only move it up one level.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('top')
  await page.evaluate(() => window.simplemark!.run('bulletList' as never))
  await page.keyboard.press('Enter')
  await page.keyboard.type('mid')
  await page.evaluate(() => window.simplemark!.run('indentListItem' as never))
  await page.keyboard.press('Enter')
  await page.keyboard.type('bottom')
  await page.evaluate(() => window.simplemark!.run('indentListItem' as never))
  await page.evaluate(() => window.simplemark!.run('indentListItem' as never))
  await expect.poll(() => markdown(page)).toMatch(/[*-] top\n\s{2,}[*-] mid\n\s{4,}[*-] bottom/)

  await page.evaluate(() => window.simplemark!.run('paragraph' as never))
  await expect.poll(() => markdown(page)).toMatch(/^bottom$/m)
  await expect.poll(() => markdown(page)).not.toMatch(/[*-]\s*bottom/)

  // A task-list item: becomes a plain paragraph and loses its checkbox.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('finish task')
  await page.evaluate(() => window.simplemark!.run('taskList' as never))
  await expect.poll(() => markdown(page)).toMatch(/[*-] \[ \] finish task/)

  await page.evaluate(() => window.simplemark!.run('paragraph' as never))
  await expect.poll(() => markdown(page)).toMatch(/^finish task$/m)
  await expect.poll(() => markdown(page)).not.toMatch(/\[ \]/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:ui -- tests/ui/styles-bar.spec.ts -g "Paragraph lifts a list item"`
Expected: FAIL — `window.simplemark!.run('paragraph' as never)` hits the `runCommand` switch's default (no-op) branch, so the first `expect.poll` after it times out because the markdown never changes (still contains `[*-] beta`, not a bare `beta` line).

- [ ] **Step 3: Add `'paragraph'` to `EditorCommandName`**

In `src/adapters/editor/milkdown-editor.ts`, change:

```ts
  | 'indentListItem'
  | 'outdentListItem'
  | 'uppercase'
```

to:

```ts
  | 'indentListItem'
  | 'outdentListItem'
  | 'paragraph'
  | 'uppercase'
```

- [ ] **Step 4: Add the `case 'paragraph'` branch**

Change:

```ts
      case 'outdentListItem':
        this.editor.action(callCommand(liftListItemCommand.key))
        return
      case 'uppercase':
```

to:

```ts
      case 'outdentListItem':
        this.editor.action(callCommand(liftListItemCommand.key))
        return
      case 'paragraph':
        this.liftListItemToParagraph()
        return
      case 'uppercase':
```

- [ ] **Step 5: Implement `liftListItemToParagraph`**

Insert directly after `toggleTaskList` ends (its closing `}`, right before the `setHighlight` method):

```ts
  /**
   * Lifts the current list item out of every enclosing list, regardless of
   * nesting depth, leaving a plain paragraph. `liftListItemCommand` (also
   * used by Outdent) only lifts one level per call — this keeps calling it
   * until the selection is no longer inside a list_item at all, which is
   * what Outdent alone does not do for nested items.
   */
  private liftListItemToParagraph(): void {
    const inListItem = (): boolean =>
      this.editor.action((ctx) => {
        const { $from } = ctx.get(editorViewCtx).state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === 'list_item') return true
        }
        return false
      })

    // A safety bound, not a meaningful limit: guards against looping forever
    // if a malformed document keeps reporting "still in a list_item".
    for (let guard = 0; guard < 50 && inListItem(); guard += 1) {
      const lifted = this.editor.action(callCommand(liftListItemCommand.key))
      if (!lifted) break
    }
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:ui -- tests/ui/styles-bar.spec.ts -g "Paragraph lifts a list item"`
Expected: PASS

- [ ] **Step 7: Run the full styles-bar spec to check for regressions**

Run: `npm run test:ui -- tests/ui/styles-bar.spec.ts`
Expected: PASS — all tests in the file, including the pre-existing ones this task didn't touch.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/editor/milkdown-editor.ts tests/ui/styles-bar.spec.ts
git commit -m "feat: lift a list item fully out of every enclosing list via Paragraph"
```

---

### Task 3: Surface Paragraph in the styles bar's Lists dropdown

**Files:**
- Modify: `src/app/ui/window-chrome.ts:713-741` (`lists` menu definition)
- Modify: `tests/ui/styles-bar.spec.ts:110` (existing menu-content assertion)
- Modify: `tests/ui/styles-bar.spec.ts` (extend the `'portable structure corrections survive as ordinary Markdown'` test)

**Interfaces:**
- Consumes: `'paragraph'` id from Task 1, already handled by `MilkdownEditor.runCommand` from Task 2 — this task only adds the button.

- [ ] **Step 1: Write the failing tests**

In `tests/ui/styles-bar.spec.ts`, change the expected Lists menu contents (line 110), inside `'every styles-bar menu mirrors Bear and every visible command is available'`:

```ts
  await expect(lists.locator(':scope > .styles-control, :scope > .styles-nested-group > .styles-nested-trigger').allTextContents())
    .resolves.toEqual(['List', 'Ordered List', 'Indent', 'Outdent', 'Block Quote', 'Todo›', 'Callout›', 'Separator'])
```

to:

```ts
  await expect(lists.locator(':scope > .styles-control, :scope > .styles-nested-group > .styles-nested-trigger').allTextContents())
    .resolves.toEqual(['List', 'Ordered List', 'Indent', 'Outdent', 'Paragraph', 'Block Quote', 'Todo›', 'Callout›', 'Separator'])
```

Then, in the same file, extend `'portable structure corrections survive as ordinary Markdown'` — change:

```ts
  await listCommand('Indent')
  await expect.poll(() => markdown(page)).toMatch(/[*-] parent\n\s{2,}[*-] child/)
  await listCommand('Outdent')
  await expect.poll(() => markdown(page)).toMatch(/[*-] parent\n[*-] child/)
```

to:

```ts
  await listCommand('Indent')
  await expect.poll(() => markdown(page)).toMatch(/[*-] parent\n\s{2,}[*-] child/)
  await listCommand('Outdent')
  await expect.poll(() => markdown(page)).toMatch(/[*-] parent\n[*-] child/)
  await listCommand('Paragraph')
  await expect.poll(() => markdown(page)).toMatch(/^child$/m)
  await expect.poll(() => markdown(page)).not.toMatch(/[*-]\s*child/)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:ui -- tests/ui/styles-bar.spec.ts -g "every styles-bar menu mirrors Bear|portable structure corrections"`
Expected: FAIL — the Lists menu content assertion is short one entry (no `'Paragraph'` button exists yet), and `listCommand('Paragraph')` can't find a button named "Paragraph" to click.

- [ ] **Step 3: Add the Paragraph button to the Lists dropdown**

In `src/app/ui/window-chrome.ts`, change:

```ts
      command('Indent', 'indentListItem'),
      command('Outdent', 'outdentListItem'),
      command('Block Quote', 'quote'),
```

to:

```ts
      command('Indent', 'indentListItem'),
      command('Outdent', 'outdentListItem'),
      command('Paragraph', 'paragraph'),
      command('Block Quote', 'quote'),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:ui -- tests/ui/styles-bar.spec.ts -g "every styles-bar menu mirrors Bear|portable structure corrections"`
Expected: PASS

- [ ] **Step 5: Run the full styles-bar spec and the application command registry tests to check for regressions**

Run: `npm run test:ui -- tests/ui/styles-bar.spec.ts && npm run test -- tests/application/commands.test.ts`
Expected: PASS — every test in both files.

- [ ] **Step 6: Commit**

```bash
git add src/app/ui/window-chrome.ts tests/ui/styles-bar.spec.ts
git commit -m "feat: surface Paragraph in the styles bar's Lists dropdown"
```
