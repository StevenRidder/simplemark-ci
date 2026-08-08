# Diagram error copy button + AI "Fix it" — design

- **Status:** Approved design, ready for planning
- **Date:** 2026-08-08
- **Companion to:** [`diagram-node-view.ts`](../../../src/adapters/editor/diagram-node-view.ts), [`ports.ts`](../../../src/application/ports.ts)

## 1. What this is

Two small additions to the diagram-error box every `DiagramRenderer` already
shows on a bad Mermaid/Graphviz/etc. block:

1. A **Copy** button that grabs the source + error, formatted, in one click —
   so it can be pasted into ChatGPT, Claude, or anywhere else, no more
   click-dragging the error text.
2. A **Fix it** button that sends the same source + error to a user-configured
   LLM API, replaces the diagram source with the model's answer, and retries
   up to 3 times until the diagram renders without error.

Both attach to the shared error path, not to any one renderer — Mermaid,
Graphviz, and any future `DiagramRenderer` all get both for free.

## 2. Copy button

Added to `.diagram-error` in `diagram-node-view.ts`, next to the existing
error text. Copies:

```
Diagram type: <language>
Error: <result.message>

Source:
```<language>
<current diagram source>
```
```

Uses the app's existing clipboard write path (`clipboard-manager:allow-write-text`
is already a granted capability). No new permission required.

## 3. Settings

New **Settings…** item in the app menu (`native-menu.ts`, alongside About),
`CmdOrCtrl+,`. Opens a form panel following the existing "Aa" reader-preferences
popover pattern in `window-chrome.ts` (floating panel, not a native dialog —
there is no native-dialog precedent in this app to match instead).

Fields:

| Field | Notes |
|---|---|
| API Key | masked input |
| Base URL | text, defaults to `https://api.openai.com/v1`; editable so it can point at any OpenAI-compatible gateway |
| Model | text, no default — the user fills in whatever they actually have access to |

Persisted with the same `normalise` / `load` / `save`-into-`localStorage`
triad every other preference in this app uses (`reader-preferences.ts`,
`ui-preferences.ts` are the precedent). New module `src/app/ai-settings.ts`,
key `simplemark.ai-settings`.

**Known tradeoff, deliberate:** this is plain `localStorage`, not OS-keychain
secrecy — consistent with how every other piece of app state is stored today,
but worth naming since it's a credential. Nothing else in this app currently
does encrypted-at-rest storage, so keychain integration would be new
infrastructure, not a pattern match; out of scope here.

## 4. Fix-it command — must run in Rust, not the webview

`capabilities/default.json` currently states, as a security guarantee: *"no
command reaches the network."* The packaged CSP backs this up:
`connect-src 'self' ipc: http://ipc.localhost` (`tauri.conf.json:28`) — a
frontend `fetch()` to `api.openai.com` is silently blocked in the packaged
app. This is the same trap that shipped Graphviz broken (dev/vitest/Playwright
don't enforce packaged CSP).

So the HTTP call is a **new Tauri command**, e.g. `ai_fix_diagram(base_url,
api_key, model, language, source, error_message) -> Result<String, String>`,
issuing the request from Rust (`reqwest` or equivalent) and returning the
model's answer over `ipc:`, which is already allowed. In browser-preview
(non-Tauri, dev-only) mode there is no CSP, so the same call is made with a
direct frontend `fetch()` instead — mirroring how other Tauri-only
capabilities already degrade in `browser.ts`.

This is the app's first network-capable command. `capabilities/default.json`'s
description must be updated to stop claiming "no command reaches the
network" once this lands — a documentation-accuracy fix, not a policy change.

**No separate consent gate (Allow/Ask/Block) is needed.** Unlike an implicit,
automatic fetch, this call only happens when the user has (a) explicitly
pasted an API key into Settings and (b) explicitly clicked Fix it on a
specific diagram. Both are per-action consent already.

## 5. Fix-it flow

Button lives in `.diagram-error` next to Copy. Disabled (tooltip: "Add an API
key in Settings") until `ai-settings` has a non-empty key.

On click, for up to 3 attempts:

1. Call `ai_fix_diagram` with the diagram's language, current source, and the
   current render error.
2. On a transport/auth failure (network error, non-2xx, malformed response):
   stop immediately — do not spend remaining attempts on a request that can't
   succeed. Show the failure distinctly from a syntax error, e.g. "API error:
   401 Unauthorized."
3. On success, strip any stray Markdown code fences from the response and
   replace the diagram's source through the same update path the manual
   source-editor textarea uses, so undo/history behaves normally.
4. Re-render (the existing `CompositeRenderer` path already runs on source
   change) and check `RenderedDiagram.ok`.
   - `true`: done. Clear the error box.
   - `false`: if attempts remain, loop — attempt *N+1*'s prompt uses the
     *new* error message and the latest source, not the original. Button
     label updates live: "Fixing… (2/3)".
5. After 3 failed attempts: stop. **Leave the last attempt's source in the
   document** (not reverted to the original) and show "Couldn't auto-fix
   after 3 attempts" next to the still-present error.

The prompt sent on each attempt: a system instruction that the model must
return only corrected `<language>` source, no explanation, no surrounding
prose; the user turn carries the source and the error message.

## 6. Out of scope

- OS-keychain storage for the API key (see §3).
- A consent toggle for network access (see §4) — explicit action already
  covers this.
- Any LLM backend other than OpenAI-compatible chat-completions shape (the
  configurable Base URL covers pointing at a compatible gateway; a
  differently-shaped API, e.g. Anthropic's `/v1/messages`, is a separate
  addition later if needed).
- Retrying anything other than diagram render errors (e.g. this does not
  apply to editor errors, app crashes, or any other error surface — those
  aren't in scope for the Copy/Fix-it pair).

## 7. Testing

| Test | Catches |
|---|---|
| Unit: Copy formats language + error + source correctly | §2 |
| Unit: `ai-settings` normalise/load/save round-trips, empty-key = disabled | §3 |
| Unit: fix-it retry loop — fail, fail, succeed within 3 | the core loop |
| Unit: fix-it retry loop — 3 straight failures leaves last attempt, shows the give-up message | §5 last bullet |
| Unit: transport/auth failure short-circuits remaining attempts | §5 step 2 |
| Unit: stray Markdown fences are stripped from a fix response | §5 step 3 |
| Playwright: stub the fix-it command, drive the button through fail→fail→succeed, assert live label updates and final render | end-to-end UX |
| **Packaged build: Fix it against a real (or locally stubbed) endpoint actually reaches the network** | §4 — the CSP risk; vitest/Playwright can't catch this |

The last row cannot run in vitest or Playwright — it requires building,
installing, and trying it in the real app, same reasoning as every other CSP-
sensitive feature in this codebase.
