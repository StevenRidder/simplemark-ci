# Model picker dropdown — design

- **Status:** Approved design, ready for implementation
- **Date:** 2026-08-08
- **Companion to:** [`2026-08-08-diagram-error-copy-and-ai-fix-design.md`](2026-08-08-diagram-error-copy-and-ai-fix-design.md) (extends the Settings panel that design introduced)

## 1. What this is

The Settings panel's Model field is free text today, and the only way to
know a valid value is to guess or query the API by hand. This adds a **Load
models** button next to it: click it, and a dropdown populates from the
configured endpoint's own model list. Picking an option fills the text
field. The text field itself is unchanged and always stays usable — this is
a convenience layered on top, not a new source of truth.

## 2. Trigger and layout

Explicit button, not automatic-on-type — same reasoning as the Fix-it
button: every outbound network call in this app is a deliberate click, never
something that fires while the user is mid-typing a credential.

```
Model  [ gpt-4o                    ]  [Load models]
       [ ▾ pick from 12 models     ]   (appears after a successful load)
```

The button is disabled until both API Key and Base URL are non-empty
(mirrors the existing Fix-it disabled-until-configured pattern). The
dropdown only exists after a successful load; nothing changes in the panel
before that click.

## 3. Network routing

Same CSP constraint as the chat-completions call: the packaged app cannot
`fetch()` an external host directly (`connect-src 'self' ipc: http://ipc.localhost`
in `tauri.conf.json`). A second Rust command, `ai_list_models(base_url: String,
api_key: String) -> Result<String, String>`, does a `GET {base_url}/models`
with a bearer token and returns the raw response body text unparsed — same
"thin transport" contract as `ai_chat_completion`, reusing the same shared,
timeout-configured `reqwest::Client`. The browser dev-preview shell calls
`fetch` directly, same asymmetry as the existing chat-completions transport.

## 4. Parsing and filtering

A new pure function, `parseModelList(responseText: string): { ok: true;
models: readonly string[] } | { ok: false; message: string }`, added
alongside `extractFixedSource` in `openai-compatible-diagram-fix.ts` (same
file — same "one place knows the OpenAI response shape" reasoning as the
existing code there):

- Parses `{ data: [{ id: string }, ...] }` (the standard `/v1/models`
  list shape).
- Filters out non-chat model IDs: any id containing `embedding`, `whisper`,
  `dall-e`, `tts`, `moderation`, `-instruct`, `-audio`, `-realtime`,
  `-image`, `-transcribe`. This is a substring blocklist, not a strict
  allowlist — an unrecognised future chat model still gets through, which
  is the safer failure direction than silently hiding it.
- Sorts the remaining ids alphabetically.
- Empty list after filtering, or a response that isn't the expected shape,
  returns `{ ok: false, message }` — never throws, matching the rest of
  this file's contract.

## 5. Error handling

A failed load (bad key, network error, non-2xx, an endpoint that doesn't
implement `/models` at all) shows a small inline message next to the button
— e.g. "Couldn't load models — type one instead" — and nothing else changes.
The text field keeps working regardless; this is strictly additive.

## 6. Out of scope

- Caching the fetched list across Settings panel opens — refetch every
  time, it's cheap and the list can change.
- Showing model metadata (context length, pricing) — just the id.
- Auto-selecting a "recommended" model — the user picks.

## 7. Testing

Settings lives only behind the native macOS menu (§2 of the parent design)
— there is no browser-mode entry point to drive with Playwright, the same
limitation the parent design's Settings panel already has. This project's
`vitest.config.ts` also runs with `environment: 'node'` deliberately (no
DOM), so `settings-panel.ts`'s own DOM/click behavior isn't unit-testable
either — same as the rest of that file today. What's covered:

| Test | Catches |
|---|---|
| Unit: `parseModelList` — valid list, filters non-chat ids, sorts | the core parsing/filtering contract |
| Unit: `parseModelList` — malformed JSON, wrong shape, empty-after-filter all return `ok: false` | error contract |
| Unit: `listModels` — transport rejection turns into `{ok:false}` rather than throwing | no-throw contract |
| Rust: `models_url` (mirrors `chat_completion_url`) — trailing-slash handling | shared with the existing pattern |
| **Packaged build (manual, same gate as the rest of Settings):** click Load models, confirm the dropdown appears and populates the text field, and that Save persists the picked value | the actual UI wiring — nothing automated reaches it |
