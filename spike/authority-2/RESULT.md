# AUTHORITY-2 — headless step authority

## Verdict

Use plain `prosemirror-transform` over a committed-step log inside the future
editor adapter.

The evidence supports headless parsing with SimpleMark's real Milkdown schema,
JSON step application, and transform-based rebasing of safe non-overlapping
text insertions. It does not select or add `prosemirror-collab`, and it does
not implement AUTHORITY-3 or AUTHORITY-4.

## Executed evidence

- `npx vitest run spike/authority-2`: 2 files and 22 tests passed. The fixture
  suite ran all ten `FIDELITY_FIXTURES`; each parsed, received two independently
  generated JSON insertion steps, applied them, rebased in both client orders,
  converged on the same document, and serialized the edited marker.
- `npm ls prosemirror-model prosemirror-state prosemirror-transform`: one
  deduplicated resolved copy of each core package: model `1.25.11`, state
  `1.4.4`, and transform `1.12.0`.
- `npm run typecheck`, `npm run check:boundaries`, and `git diff --check` all
  exited successfully. The boundary check reported 252 modules and 435
  dependencies with no violations.

## Fidelity-baseline treatment

Each scenario records `untouchedRawBaseline` before parsing or serialization.
The fixture test compares it directly to `readFixture`'s raw bytes for all ten
inputs, including fixture 09's CRLF and missing final newline. This records
the untouched input faithfully for the supplied UTF-8 corpus; it is not a
claim that the Markdown serializer preserves those bytes. No serializer output
was asserted byte-equal to the raw fixture.

## Not proven

- Mounted `EditorView`, NodeViews, or decorations.
- Undo/history ownership.
- Disconnect/reconnect behavior.
- Pitter Patter contention or any multi-process/network transport.
- Arbitrary overlapping or conflicting edits, source-preserving edited-file
  writes, or raw serializer equality.
