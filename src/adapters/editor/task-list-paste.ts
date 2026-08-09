import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'

/**
 * A task list pasted from anywhere else keeps its ticks.
 *
 * GFM already gives `list_item` a `checked` attribute, a `toDOM` that writes
 * `li[data-item-type="task"][data-checked]`, and a serializer that emits
 * `[x]` / `[ ]`. All of that works. What it has no rule for is the shape every
 * *other* tool publishes: a real `<input type="checkbox">` inside the item.
 * Its only `parseDOM` entry matches the attributes Milkdown itself writes, so
 * a paste from a chat UI, GitHub, Notion or Confluence fell through to the
 * plain `li` rule and arrived as an ordinary bullet with the state discarded
 * — silently, because the text was all still there.
 *
 * This adds the missing rule and nothing else: same node, same attribute, same
 * serializer. Deliberately keyed on the checkbox rather than on a class name,
 * because `task-list-item` is remark-gfm's convention and app-styled lists do
 * not use it — a class-keyed rule would keep the ticks for GitHub and quietly
 * drop them for everyone else.
 */

/**
 * The checkbox that belongs to this item, not to one nested inside it.
 *
 * `querySelectorAll` descends through a nested `<ul>`, so a parent whose own
 * label carries no box would otherwise inherit its first child's state. The
 * closest-`li` check is what keeps each depth of a nested task list honest.
 */
function ownCheckbox(item: HTMLElement): HTMLInputElement | null {
  const boxes = item.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  for (const box of boxes) {
    if (box.closest('li') === item) return box
  }
  return null
}

export const pastedTaskListSchema = extendListItemSchemaForTask.extendSchema((prev) => {
  return (ctx) => {
    const base = prev(ctx)
    return {
      ...base,
      parseDOM: [
        {
          tag: 'li',
          getAttrs: (dom: HTMLElement | string) => {
            // Never throws (AGENTS.md): anything that is not an element, or an
            // item with no box of its own, is simply not a task — `false`
            // declines the rule and the ordinary `li` rule below answers.
            if (typeof dom === 'string' || !(dom instanceof HTMLElement)) return false
            const box = ownCheckbox(dom)
            return box === null ? false : { checked: box.checked }
          },
        },
        ...(base.parseDOM ?? []),
      ],
    }
  }
})
