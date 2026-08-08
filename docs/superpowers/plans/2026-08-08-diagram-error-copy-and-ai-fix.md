# Diagram Error Copy Button + AI Fix-It Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Copy" button and an AI-powered "Fix it" button to the error box every diagram renderer (Mermaid, Graphviz, and any future one) already shows on a broken block, backed by a new Settings panel where the user pastes an OpenAI-compatible API key.

**Architecture:** A new `DiagramFixPort` (mirroring the existing `DiagramRenderer`/`ClipboardPort` pattern in `application/ports.ts`) is implemented once, platform-agnostically, by `OpenAiCompatibleDiagramFixPort`, which is handed a small HTTP transport function that differs only by platform (a Rust-side Tauri command in the packaged app, a direct `fetch` in the browser dev shell — the packaged app's CSP blocks a frontend `fetch` to any external host). `DiagramNodeView` owns the retry loop (up to 3 attempts, replacing the diagram source and re-rendering after each), since it already owns the error box, the source textarea, and the render call. Settings are persisted with the same `localStorage` normalise/load/save pattern every other preference in this app already uses.

**Tech Stack:** TypeScript (frontend, all platforms), Rust + `reqwest` (new Tauri command), Vitest (unit), Playwright (end-to-end).

## Global Constraints

- Every port method that can fail resolves `{ ok: false, message }` — it never throws (`application/ports.ts`'s existing convention for `RenderedDiagram` and every renderer).
- The packaged app's CSP is `connect-src 'self' ipc: http://ipc.localhost` (`src-tauri/tauri.conf.json:28`) — no frontend code may `fetch()` an external host in the Tauri build. All outbound AI requests in the packaged app go through the new `ai_chat_completion` Rust command.
- `capabilities/default.json`'s description currently claims "no command reaches the network" — that line must be corrected once `ai_chat_completion` exists, since leaving it would make the manifest false.
- All new persisted state uses the existing `Pick<Storage, 'getItem' | 'setItem'>` storage-injection pattern (never a direct `window.localStorage` reference inside a pure module), so tests can inject an in-memory fake exactly as `tests/app/reader-preferences.test.ts` does today.
- Relative imports use an explicit `.js` extension (NodeNext resolution) — every new import in this plan follows that.
- Up to 3 fix attempts total. A transport/auth failure (bad key, network error, non-2xx, malformed response) stops the loop immediately on whichever attempt it happens on — it does not consume the remaining attempts. A still-broken diagram after all 3 attempts keeps the last attempt's source in the document (never reverted) and shows a give-up message.

---

### Task 1: AI settings persistence

**Files:**
- Create: `src/app/ai-settings.ts`
- Test: `tests/app/ai-settings.test.ts`

**Interfaces:**
- Produces: `AiSettings { apiKey: string; baseUrl: string; model: string }`, `DEFAULT_AI_SETTINGS: AiSettings`, `normaliseAiSettings(value: unknown): AiSettings`, `isAiConfigured(settings: AiSettings): boolean`, `loadAiSettings(storage: Pick<Storage,'getItem'>): AiSettings`, `saveAiSettings(storage: Pick<Storage,'setItem'>, settings: AiSettings): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/app/ai-settings.test.ts
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AI_SETTINGS,
  isAiConfigured,
  loadAiSettings,
  normaliseAiSettings,
  saveAiSettings,
} from '../../src/app/ai-settings.js'

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial }
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage
}

describe('normaliseAiSettings', () => {
  it('falls back to defaults for garbage input', () => {
    expect(normaliseAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS)
    expect(normaliseAiSettings('nope')).toEqual(DEFAULT_AI_SETTINGS)
    expect(normaliseAiSettings({})).toEqual(DEFAULT_AI_SETTINGS)
  })

  it('trims strings and strips a trailing slash from the base URL', () => {
    expect(
      normaliseAiSettings({ apiKey: '  sk-abc  ', baseUrl: 'https://x.test/v1/', model: ' gpt-4o ' }),
    ).toEqual({ apiKey: 'sk-abc', baseUrl: 'https://x.test/v1', model: 'gpt-4o' })
  })

  it('falls back to the default base URL when the given one is blank', () => {
    expect(normaliseAiSettings({ baseUrl: '   ' }).baseUrl).toBe(DEFAULT_AI_SETTINGS.baseUrl)
  })
})

describe('isAiConfigured', () => {
  it('requires all three fields non-empty', () => {
    expect(isAiConfigured(DEFAULT_AI_SETTINGS)).toBe(false)
    expect(isAiConfigured({ apiKey: 'k', baseUrl: 'https://x.test', model: '' })).toBe(false)
    expect(isAiConfigured({ apiKey: 'k', baseUrl: 'https://x.test', model: 'gpt-4o' })).toBe(true)
  })
})

describe('load/save round trip', () => {
  it('persists and reloads settings', () => {
    const storage = fakeStorage()
    saveAiSettings(storage, { apiKey: 'k', baseUrl: 'https://x.test', model: 'gpt-4o' })
    expect(loadAiSettings(storage)).toEqual({ apiKey: 'k', baseUrl: 'https://x.test', model: 'gpt-4o' })
  })

  it('returns defaults when nothing is stored or storage throws', () => {
    expect(loadAiSettings(fakeStorage())).toEqual(DEFAULT_AI_SETTINGS)
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Pick<Storage, 'getItem'>
    expect(loadAiSettings(throwing)).toEqual(DEFAULT_AI_SETTINGS)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/app/ai-settings.test.ts`
Expected: FAIL — `Cannot find module '../../src/app/ai-settings.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/app/ai-settings.ts
/**
 * Credentials and endpoint for the diagram-error "Fix it" button (EDITOR
 * error-recovery). App state, never document content — nothing here is ever
 * written to a `.md` file, matching reader-preferences.ts's own reasoning.
 *
 * Plain localStorage, like every other preference in this app. That is a
 * known, deliberate tradeoff for a credential: no OS-keychain integration
 * exists anywhere in this codebase today, so adding one here would be new
 * infrastructure for one field rather than following an existing pattern.
 */

export interface AiSettings {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
}

function normaliseString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

/** Validates whatever came out of storage or a settings form — both untrusted. */
export function normaliseAiSettings(value: unknown): AiSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_AI_SETTINGS
  const candidate = value as Partial<Record<keyof AiSettings, unknown>>
  const baseUrl = normaliseString(candidate.baseUrl, DEFAULT_AI_SETTINGS.baseUrl).replace(/\/+$/, '')
  return {
    apiKey: normaliseString(candidate.apiKey, DEFAULT_AI_SETTINGS.apiKey),
    baseUrl: baseUrl === '' ? DEFAULT_AI_SETTINGS.baseUrl : baseUrl,
    model: normaliseString(candidate.model, DEFAULT_AI_SETTINGS.model),
  }
}

/** Whether a fix attempt can be made at all — false until all three fields are filled in. */
export function isAiConfigured(settings: AiSettings): boolean {
  return settings.apiKey !== '' && settings.baseUrl !== '' && settings.model !== ''
}

const AI_SETTINGS_KEY = 'simplemark.ai-settings'

export function loadAiSettings(storage: Pick<Storage, 'getItem'>): AiSettings {
  try {
    const raw = storage.getItem(AI_SETTINGS_KEY)
    return raw === null ? DEFAULT_AI_SETTINGS : normaliseAiSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_AI_SETTINGS
  }
}

export function saveAiSettings(storage: Pick<Storage, 'setItem'>, settings: AiSettings): void {
  try {
    storage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // A key that cannot be persisted is not worth failing Settings over.
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/app/ai-settings.test.ts`
Expected: PASS, all 7 assertions

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-settings.ts tests/app/ai-settings.test.ts
git commit -m "feat: add AI settings persistence for diagram fix-it"
```

---

### Task 2: Diagram-fix port and OpenAI-compatible adapter

**Files:**
- Modify: `src/application/ports.ts` (append at the very end of the file, after whatever interface is currently last — `ClipboardPort` when this plan was written, but other ports may have landed after it since; append after all of them, not in the middle)
- Modify: `src/application/index.ts` (add the two new type exports to the existing `export type { ... } from './ports.js'` block, `index.ts:9-24`)
- Create: `src/adapters/ai/openai-compatible-diagram-fix.ts`
- Test: `tests/adapters/openai-compatible-diagram-fix.test.ts`

**Interfaces:**
- Consumes: `AiSettings`, `isAiConfigured` from Task 1 (`src/app/ai-settings.js`).
- Produces: `DiagramFixResult = { ok: true; source: string } | { ok: false; message: string }`, `DiagramFixPort { isConfigured(): boolean; fix(language: string, source: string, errorMessage: string): Promise<DiagramFixResult> }` (both from `application/ports.ts` / re-exported by `application/index.ts`), `ChatMessage { role: 'system' | 'user'; content: string }`, `ChatCompletionTransport = (baseUrl: string, apiKey: string, model: string, messages: readonly ChatMessage[]) => Promise<string>`, `OpenAiCompatibleDiagramFixPort` (implements `DiagramFixPort`, constructed with `(transport: ChatCompletionTransport, getSettings: () => AiSettings)`). Task 4 constructs one instance per platform with a platform-specific transport.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/adapters/openai-compatible-diagram-fix.test.ts
import { describe, expect, it } from 'vitest'

import { OpenAiCompatibleDiagramFixPort } from '../../src/adapters/ai/openai-compatible-diagram-fix.js'
import type { ChatMessage } from '../../src/adapters/ai/openai-compatible-diagram-fix.js'
import type { AiSettings } from '../../src/app/ai-settings.js'

const CONFIGURED: AiSettings = { apiKey: 'sk-abc', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }
const UNCONFIGURED: AiSettings = { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: '' }

function chatCompletionResponse(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] })
}

describe('isConfigured', () => {
  it('reflects the current settings, not a snapshot taken at construction', () => {
    let settings = UNCONFIGURED
    const port = new OpenAiCompatibleDiagramFixPort(async () => '', () => settings)
    expect(port.isConfigured()).toBe(false)
    settings = CONFIGURED
    expect(port.isConfigured()).toBe(true)
  })
})

describe('fix', () => {
  it('refuses without needing a network call when unconfigured', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => {
      throw new Error('must not be called')
    }, () => UNCONFIGURED)
    const result = await port.fix('mermaid', 'flowchart TD', 'parse error')
    expect(result).toEqual({ ok: false, message: 'Add an API key in Settings before using Fix it.' })
  })

  it('sends the language, source, and error in the user turn, and passes settings through', async () => {
    let seen: { baseUrl: string; apiKey: string; model: string; messages: readonly ChatMessage[] } | undefined
    const port = new OpenAiCompatibleDiagramFixPort(async (baseUrl, apiKey, model, messages) => {
      seen = { baseUrl, apiKey, model, messages }
      return chatCompletionResponse('flowchart TD\n  A --> B')
    }, () => CONFIGURED)

    const result = await port.fix('mermaid', 'flowchart TD\n  A -> B', 'Parse error on line 1')
    expect(result).toEqual({ ok: true, source: 'flowchart TD\n  A --> B' })
    expect(seen?.baseUrl).toBe(CONFIGURED.baseUrl)
    expect(seen?.apiKey).toBe(CONFIGURED.apiKey)
    expect(seen?.model).toBe(CONFIGURED.model)
    expect(seen?.messages[0]?.role).toBe('system')
    expect(seen?.messages[1]).toEqual({
      role: 'user',
      content: expect.stringContaining('flowchart TD\n  A -> B') as unknown as string,
    })
    expect(seen?.messages[1]?.content).toContain('Parse error on line 1')
    expect(seen?.messages[1]?.content).toContain('mermaid')
  })

  it('strips a Markdown fence the model wrapped the answer in', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(
      async () => chatCompletionResponse('```mermaid\nflowchart TD\n  A --> B\n```'),
      () => CONFIGURED,
    )
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result).toEqual({ ok: true, source: 'flowchart TD\n  A --> B' })
  })

  it('fails on an empty answer rather than writing a blank diagram', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => chatCompletionResponse('   '), () => CONFIGURED)
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result.ok).toBe(false)
  })

  it('fails on a response that is not the expected shape', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => '{"unexpected": true}', () => CONFIGURED)
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result.ok).toBe(false)
  })

  it('turns a transport rejection into an ok:false result instead of throwing', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => {
      throw new Error('API error 401: unauthorized')
    }, () => CONFIGURED)
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result).toEqual({ ok: false, message: 'API error 401: unauthorized' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/adapters/openai-compatible-diagram-fix.test.ts`
Expected: FAIL — `Cannot find module '../../src/adapters/ai/openai-compatible-diagram-fix.js'`

- [ ] **Step 3: Add the port to `application/ports.ts`**

Append at the very end of the file (after whatever is currently last there — do not insert in the middle of the file):

```ts
/** The outcome of asking a model to fix broken diagram source. Failure is a value, never a throw. */
export type DiagramFixResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly message: string }

/**
 * Asks a configured LLM to correct diagram source that failed to render.
 *
 * A port, for the same reason `DiagramRenderer` is one: the editor adapter
 * must not depend on a concrete HTTP client, and the packaged app's CSP means
 * the concrete implementation differs by platform (a Rust command vs. a
 * direct `fetch`) even though the request/response shape does not.
 */
export interface DiagramFixPort {
  /** Whether a fix attempt can be made right now — false until Settings has a key, base URL, and model. */
  isConfigured(): boolean
  /** Never throws; a transport or parsing failure resolves `{ ok: false, message }`. */
  fix(language: string, source: string, errorMessage: string): Promise<DiagramFixResult>
}
```

- [ ] **Step 4: Export the new types from `application/index.ts`**

Find the existing `export type { ... } from './ports.js'` block near the top of the file. **Do not retype or reorder its existing contents** — whatever names are already in that list (it has grown since this plan was drafted; treat the file on disk as truth, not any list reproduced here) must all remain exactly as they are. Add exactly two new names, `DiagramFixResult` and `DiagramFixPort`, anywhere in the list — e.g. as two new lines directly before the closing `} from './ports.js'`.

- [ ] **Step 5: Write the adapter**

```ts
// src/adapters/ai/openai-compatible-diagram-fix.ts
import type { AiSettings } from '../../app/ai-settings.js'
import { isAiConfigured } from '../../app/ai-settings.js'
import type { DiagramFixPort, DiagramFixResult } from '../../application/index.js'

export interface ChatMessage {
  readonly role: 'system' | 'user'
  readonly content: string
}

/**
 * One authenticated OpenAI-compatible `/chat/completions` call.
 *
 * The only thing that differs by platform. The packaged app's CSP forbids a
 * frontend `fetch` to an external host, so its transport goes through a Rust
 * command instead; the browser dev shell's transport is a plain `fetch`. Both
 * return the raw response body text — parsing the OpenAI response shape stays
 * in one place (this file) rather than being duplicated per platform.
 */
export type ChatCompletionTransport = (
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: readonly ChatMessage[],
) => Promise<string>

const SYSTEM_PROMPT =
  'You fix broken diagram source code embedded in a Markdown document. ' +
  'You will be given the diagram language, the current source, and the error its renderer produced. ' +
  'Reply with ONLY the corrected source in that same language — no explanation, no surrounding prose, ' +
  'no Markdown code fence.'

function userTurn(language: string, source: string, errorMessage: string): string {
  return [
    `Diagram type: ${language}`,
    `Error: ${errorMessage}`,
    '',
    'Source:',
    source,
  ].join('\n')
}

/** Strips a Markdown fence the model wrapped its answer in, despite being asked not to. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return (match?.[1] ?? trimmed).trim()
}

/** Parses an OpenAI-shape chat-completion response body into a fix result. */
export function extractFixedSource(responseText: string): DiagramFixResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    return { ok: false, message: 'The API response was not valid JSON.' }
  }
  const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    return { ok: false, message: 'The API response did not include a message.' }
  }
  const source = stripCodeFence(content)
  if (source === '') {
    return { ok: false, message: 'The API returned an empty answer.' }
  }
  return { ok: true, source }
}

export class OpenAiCompatibleDiagramFixPort implements DiagramFixPort {
  constructor(
    private readonly transport: ChatCompletionTransport,
    private readonly getSettings: () => AiSettings,
  ) {}

  isConfigured(): boolean {
    return isAiConfigured(this.getSettings())
  }

  async fix(language: string, source: string, errorMessage: string): Promise<DiagramFixResult> {
    const settings = this.getSettings()
    if (!isAiConfigured(settings)) {
      return { ok: false, message: 'Add an API key in Settings before using Fix it.' }
    }
    try {
      const responseText = await this.transport(settings.baseUrl, settings.apiKey, settings.model, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userTurn(language, source, errorMessage) },
      ])
      return extractFixedSource(responseText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/adapters/openai-compatible-diagram-fix.test.ts`
Expected: PASS, all 8 assertions

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck` (or the project's equivalent `tsc --noEmit` script — check `package.json` if the name differs)
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/application/ports.ts src/application/index.ts src/adapters/ai/openai-compatible-diagram-fix.ts tests/adapters/openai-compatible-diagram-fix.test.ts
git commit -m "feat: add DiagramFixPort and an OpenAI-compatible adapter"
```

---

### Task 3: Rust `ai_chat_completion` command

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `reqwest` dependency)
- Modify: `src-tauri/src/lib.rs` (new command near `build_provenance`, `lib.rs:72-81`; register in `generate_handler!`, `lib.rs:1281-1309`; two new tests in the existing `mod tests` block, `lib.rs:1325`)
- Modify: `src-tauri/capabilities/default.json` (correct the "no command reaches the network" claim)

**Interfaces:**
- Produces: Tauri command `ai_chat_completion(base_url: String, api_key: String, model: String, messages: Vec<ChatMessage>) -> Result<String, String>`, invoked from the frontend as `invoke('ai_chat_completion', { baseUrl, apiKey, model, messages })`. Task 4's Tauri transport calls this.

- [ ] **Step 1: Add the `reqwest` dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]` (after `base64 = "0.22"`):

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

`rustls-tls` avoids a system OpenSSL dependency, keeping the same "no extra system library" story the rest of this crate already has.

- [ ] **Step 2: Write the failing Rust tests**

Add to the existing `mod tests` block at the bottom of `src-tauri/src/lib.rs` (after `identical_content_hashes_identically`, `lib.rs:1358-1362`):

```rust
    #[test]
    fn chat_completion_url_appends_the_endpoint_regardless_of_a_trailing_slash() {
        assert_eq!(
            chat_completion_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completion_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn chat_completion_body_carries_the_model_and_messages_verbatim() {
        let messages = vec![ChatMessage {
            role: "system".to_string(),
            content: "fix it".to_string(),
        }];
        let body = chat_completion_body("gpt-4o", &messages);
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "fix it");
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test chat_completion`
Expected: FAIL to compile — `chat_completion_url`, `chat_completion_body`, and `ChatMessage` are not defined

- [ ] **Step 4: Write the command**

In `src-tauri/src/lib.rs`, insert after the `build_provenance` function (ends `lib.rs:81`):

```rust
/// One message in an OpenAI-compatible chat-completion request.
#[derive(serde::Serialize, serde::Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn chat_completion_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

fn chat_completion_body(model: &str, messages: &[ChatMessage]) -> serde_json::Value {
    serde_json::json!({ "model": model, "messages": messages })
}

/// The diagram-error "Fix it" button's one network call (EDITOR error-recovery).
///
/// This crate is a thin transport everywhere else (module doc, top of this
/// file) and stays one here too: it knows the OpenAI request/response
/// envelope only as far as building the URL and the `{model, messages}` body,
/// and returns the response text unparsed. Everything else — the prompt, the
/// retry loop, extracting the fixed source from the response — lives in the
/// shared TypeScript adapter that also drives the browser dev shell's direct
/// `fetch`, so the two platforms cannot drift.
///
/// Going through Rust is not optional: the packaged app's CSP
/// (`connect-src 'self' ipc: http://ipc.localhost`, tauri.conf.json) silently
/// blocks a frontend `fetch` to any external host.
#[tauri::command]
async fn ai_chat_completion(
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = chat_completion_url(&base_url);
    let body = chat_completion_body(&model, &messages);
    let response = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not reach {url}: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the response from {url}: {error}"))?;
    if !status.is_success() {
        return Err(format!("{url} returned {status}: {text}"));
    }
    Ok(text)
}
```

- [ ] **Step 5: Register the command**

In the `generate_handler!` list (`lib.rs:1281-1309`), add `ai_chat_completion` after `build_provenance`:

```rust
            build_provenance,
            ai_chat_completion,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test chat_completion`
Expected: PASS, both tests

- [ ] **Step 7: Correct the capabilities manifest**

`src-tauri/capabilities/default.json` currently reads (in full):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "The main window may open a file picker, move or resize its native window, and call SimpleMark's audited note and workspace commands — including reading a data file a chart names, resolved against the open note by the same rules a Markdown link obeys. No general filesystem, shell, or network permission is granted: every file touch goes through this crate's narrow commands, and no command reaches the network.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-toggle-maximize",
    "core:window:allow-set-position",
    "core:window:allow-set-size",
    "core:window:allow-maximize",
    "dialog:allow-open",
    "dialog:allow-save",
    "clipboard-manager:allow-write-text"
  ]
}
```

Replace only the `description` field (the `permissions` array is unaffected — `ai_chat_completion` is a plain app command, not a plugin permission, so it needs no new entry there):

```json
  "description": "The main window may open a file picker, move or resize its native window, and call SimpleMark's audited note and workspace commands — including reading a data file a chart names, resolved against the open note by the same rules a Markdown link obeys, and — only when the user has explicitly clicked \"Fix it\" on a broken diagram with an API key configured in Settings — an authenticated chat-completion request to the endpoint that key belongs to. No general filesystem, shell, or unscoped network permission is granted: every other capability goes through this crate's narrow commands, and network access is limited to that one explicit, user-initiated, user-configured call.",
```

- [ ] **Step 8: Build check**

Run: `cd src-tauri && cargo check`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: add ai_chat_completion Tauri command for diagram fix-it"
```

---

### Task 4: Wire the new port through both platforms and the editor

**Files:**
- Modify: `src/app/bootstrap.ts` (`AppPorts` interface `bootstrap.ts:53-59`; add `DiagramFixPort`/`ClipboardPort` to the existing type import at the top of the file; thread `clipboard`/`diagramFix` into the `MilkdownEditor.mount` call, `bootstrap.ts:622-668`)
- Modify: `src/adapters/editor/milkdown-editor.ts` (widen `MilkdownEditorOptions`, `milkdown-editor.ts:155-165`; widen the type import at `milkdown-editor.ts:51`; pass the two new args at both `new DiagramNodeView(...)` call sites, `milkdown-editor.ts:204` and `:211`)
- Modify: `src/app/browser.ts` (construct and wire the browser `ChatCompletionTransport`)
- Modify: `src/app/tauri.ts` (construct and wire the Tauri `ChatCompletionTransport`)

**Interfaces:**
- Consumes: `OpenAiCompatibleDiagramFixPort`, `ChatCompletionTransport` (Task 2); `loadAiSettings` (Task 1); `ai_chat_completion` Tauri command (Task 3).
- Produces: `ports.diagramFix: DiagramFixPort` available inside `composeApp`, and `DiagramNodeView` constructed with `(node, view, getPos, renderer, clipboard?, diagramFix?)` — Task 5 uses both new parameters.

- [ ] **Step 1: Widen `AppPorts` and the composition call in `bootstrap.ts`**

Change the type import at the top of the file:

```ts
import type {
  AssetReferencePort,
  ClipboardPort,
  DiagramFixPort,
  DiagramRenderer,
  DocumentLinkPort,
  FilePort,
} from '../application/index.js'
```

Add one field to `AppPorts` (`bootstrap.ts:53-59`):

```ts
export interface AppPorts {
  readonly file: FilePort
  readonly assets?: AssetReferencePort
  readonly links?: DocumentLinkPort
  readonly clipboard?: ClipboardPort
  readonly diagrams: DiagramRenderer
  readonly diagramFix?: DiagramFixPort
}
```

In the `MilkdownEditor.mount({ ... })` call inside `composeApp` (`bootstrap.ts:622-633`), add two lines so the editor receives the same ports the rest of the app already has:

```ts
  editor = await MilkdownEditor.mount({
    mount: chrome.editorHost,
    initialMarkdown: session.snapshot().markdown,
    renderer: ports.diagrams,
    clipboard: ports.clipboard,
    diagramFix: ports.diagramFix,
    onCopyDeferredTable: async (source) => {
```

- [ ] **Step 2: Widen `MilkdownEditorOptions` and the two `DiagramNodeView` call sites**

Change the type import at the top of `milkdown-editor.ts` (line 51):

```ts
import type { AssetReference, ClipboardPort, DiagramFixPort, DiagramRenderer } from '../../application/index.js'
```

Add two optional fields to `MilkdownEditorOptions` (`milkdown-editor.ts:155-165`):

```ts
export interface MilkdownEditorOptions {
  readonly mount: HTMLElement
  readonly initialMarkdown: string
  readonly renderer: DiagramRenderer
  /** Backs the diagram-error box's Copy button. Absent hides that button. */
  readonly clipboard?: ClipboardPort
  /** Backs the diagram-error box's Fix it button. Absent hides that button. */
  readonly diagramFix?: DiagramFixPort
  /** Called after every user edit, with the serialised document. */
  readonly onMarkdownChanged: (markdown: string) => void
  /** Opens a rendered link through the shell's explicit platform boundary. */
  readonly onOpenLink?: (href: string) => Promise<void>
  /** Copies a virtualised table through the shell's clipboard boundary. */
  readonly onCopyDeferredTable?: (source: string) => Promise<boolean>
}
```

Update both `DiagramNodeView` construction sites (`milkdown-editor.ts:204` and `:211`) to pass the two new arguments:

```ts
        return new DiagramNodeView(node, view, getPos, options.renderer, options.clipboard, options.diagramFix)
```

```ts
      return new DiagramNodeView(node, view, getPos, options.renderer, options.clipboard, options.diagramFix)
```

(`InlineMathNodeView` and `AssetImageNodeView`, the other two `$view` factories in this file, are unrelated node types and are not touched.)

- [ ] **Step 3: Wire the transport in `browser.ts`**

Add imports near the other adapter imports (after the `BrowserClipboardPort` import):

```ts
import { OpenAiCompatibleDiagramFixPort } from '../adapters/ai/openai-compatible-diagram-fix.js'
import type { ChatCompletionTransport } from '../adapters/ai/openai-compatible-diagram-fix.js'
import { loadAiSettings } from './ai-settings.js'
```

In `mount()`, before the `composeApp({ ports: { ... } })` call, define the transport and add `diagramFix` to the `ports` object (alongside the existing `diagrams: new CompositeRenderer([...])`):

```ts
  const chatCompletionTransport: ChatCompletionTransport = async (baseUrl, apiKey, model, messages) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${baseUrl}/chat/completions returned ${response.status}: ${text}`)
    return text
  }

  app = await composeApp({
    ports: {
      file,
      assets: new BrowserAssetReferencePort(pickDocumentAsset, window),
      links: new BrowserDocumentLinkPort(window),
      clipboard: new BrowserClipboardPort(),
      diagramFix: new OpenAiCompatibleDiagramFixPort(chatCompletionTransport, () => loadAiSettings(window.localStorage)),
      diagrams: new CompositeRenderer([
```

(Everything from `diagrams: new CompositeRenderer([` onward is unchanged — only the two new lines above it are added.)

- [ ] **Step 4: Wire the transport in `tauri.ts`**

Add imports near the other adapter imports (after the `BrowserClipboardPort` import):

```ts
import { OpenAiCompatibleDiagramFixPort } from '../adapters/ai/openai-compatible-diagram-fix.js'
import type { ChatCompletionTransport } from '../adapters/ai/openai-compatible-diagram-fix.js'
import { loadAiSettings } from './ai-settings.js'
```

In the module's `mount()` function, before its `composeApp({ ports: { ... } })` call (`tauri.ts:875-895`), define the transport and add `diagramFix`:

```ts
  const chatCompletionTransport: ChatCompletionTransport = (baseUrl, apiKey, model, messages) =>
    invoke('ai_chat_completion', { baseUrl, apiKey, model, messages })

  app = await composeApp({
    ports: {
      file,
      assets: new BrowserAssetReferencePort(pickDocumentAsset, window),
      links: new TauriDocumentLinkPort(invoke),
      clipboard: new BrowserClipboardPort(),
      diagramFix: new OpenAiCompatibleDiagramFixPort(chatCompletionTransport, () => loadAiSettings(window.localStorage)),
      diagrams: new CompositeRenderer([
```

(Everything from `diagrams: new CompositeRenderer([` onward is unchanged.)

- [ ] **Step 5: Typecheck and run the existing suite**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all previously-passing tests still pass (no behaviour changed yet — `DiagramNodeView` does not use the new constructor arguments until Task 5)

- [ ] **Step 6: Commit**

```bash
git add src/app/bootstrap.ts src/adapters/editor/milkdown-editor.ts src/app/browser.ts src/app/tauri.ts
git commit -m "feat: wire DiagramFixPort through both platforms"
```

---

### Task 5: Copy and Fix-it buttons in the diagram error box

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts` (full rewrite of the `#error` construction, `#paint`, `#commitSource`, `destroy`; new private fields and methods)
- Modify: `src/app/styles/app.css` (extend `.diagram-error`, `diagram-error-copy`/`-fix`/`-message`/`-actions`, `app.css:2755-2764`)
- Test: `tests/adapters/diagram-error-copy-format.test.ts`

**Interfaces:**
- Consumes: `ClipboardPort`, `DiagramFixPort`, `DiagramFixResult` (Tasks 2 and 4).
- Produces: `formatDiagramErrorForCopy(language: string, source: string, errorMessage: string): string`, exported from `diagram-node-view.ts` for the unit test; `DiagramNodeView` constructor becomes `(node, view, getPos, renderer, clipboard?, diagramFix?)`.

- [ ] **Step 1: Write the failing unit test for the pure formatter**

```ts
// tests/adapters/diagram-error-copy-format.test.ts
import { describe, expect, it } from 'vitest'

import { formatDiagramErrorForCopy } from '../../src/adapters/editor/diagram-node-view.js'

describe('formatDiagramErrorForCopy', () => {
  it('carries the language, error, and source in one pasteable block', () => {
    const text = formatDiagramErrorForCopy('mermaid', 'flowchart TD\n  A -> B', 'Parse error on line 1')
    expect(text).toBe(
      'Diagram type: mermaid\n' +
      'Error: Parse error on line 1\n' +
      '\n' +
      'Source:\n' +
      '```mermaid\n' +
      'flowchart TD\n  A -> B\n' +
      '```\n',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/adapters/diagram-error-copy-format.test.ts`
Expected: FAIL — `formatDiagramErrorForCopy` is not exported

- [ ] **Step 3: Rewrite the error box construction and add the pure formatter**

In `src/adapters/editor/diagram-node-view.ts`, add to the top-of-file imports (after the existing `import type { DiagramRenderer } from '../../application/index.js'`):

```ts
import type { ClipboardPort, DiagramFixPort, RenderedDiagram } from '../../application/index.js'
```

Add this exported pure function near the top of the file, after the `naturalWidth` function and before the `DiagramNodeView` class:

```ts
/** One pasteable block: language, error, and source together (diagram-error Copy button). */
export function formatDiagramErrorForCopy(language: string, source: string, errorMessage: string): string {
  return `Diagram type: ${language}\nError: ${errorMessage}\n\nSource:\n\`\`\`${language}\n${source}\n\`\`\`\n`
}
```

Change the class field declarations (replacing the single `readonly #error: HTMLElement` line) to:

```ts
  readonly #error: HTMLElement
  readonly #errorMessage: HTMLElement
  readonly #copyButton: HTMLButtonElement
  readonly #fixButton: HTMLButtonElement
```

Change the constructor signature to accept the two new optional ports:

```ts
  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: DiagramRenderer,
    private readonly clipboard?: ClipboardPort,
    private readonly diagramFix?: DiagramFixPort,
  ) {
```

Replace the existing error-box construction block —

```ts
    this.#error = document.createElement('div')
    this.#error.className = 'diagram-error'
    this.#error.hidden = true
```

— with:

```ts
    this.#error = document.createElement('div')
    this.#error.className = 'diagram-error'
    this.#error.hidden = true

    const actions = document.createElement('div')
    actions.className = 'diagram-error-actions'

    this.#copyButton = document.createElement('button')
    this.#copyButton.type = 'button'
    this.#copyButton.className = 'diagram-error-copy'
    this.#copyButton.textContent = 'Copy'
    this.#copyButton.hidden = this.clipboard === undefined
    this.#copyButton.addEventListener('click', (event) => {
      event.preventDefault()
      void this.#copyError()
    })

    this.#fixButton = document.createElement('button')
    this.#fixButton.type = 'button'
    this.#fixButton.className = 'diagram-error-fix'
    this.#fixButton.textContent = 'Fix it'
    this.#fixButton.hidden = this.diagramFix === undefined
    this.#fixButton.addEventListener('click', (event) => {
      event.preventDefault()
      void this.#runFix()
    })

    this.#errorMessage = document.createElement('pre')
    this.#errorMessage.className = 'diagram-error-message'

    actions.append(this.#copyButton, this.#fixButton)
    this.#error.append(actions, this.#errorMessage)
```

(The line below it, `this.dom.append(label, this.#toggle, this.#render, this.#error)`, is unchanged — `#error` still carries everything inside it.)

- [ ] **Step 4: Extract the ProseMirror write from `#commitSource`, and make `#paint` return and report the result**

Replace the existing `#commitSource` method —

```ts
  /** Writes the textarea's content back through ProseMirror, never into the DOM. */
  #commitSource(): void {
    const pos = this.getPos()
    if (pos === undefined) return

    const { state, dispatch } = this.view
    const from = pos + 1
    const to = pos + this.#node.nodeSize - 1
    const text = this.#textarea.value

    const transaction = state.tr.replaceWith(
      from,
      to,
      text === '' ? [] : state.schema.text(text),
    )
    dispatch(transaction)
    void this.#paint()
  }
```

with:

```ts
  /** Writes text back through ProseMirror, never into the DOM. Does not repaint. */
  #writeSource(text: string): void {
    const pos = this.getPos()
    if (pos === undefined) return

    const { state, dispatch } = this.view
    const from = pos + 1
    const to = pos + this.#node.nodeSize - 1

    const transaction = state.tr.replaceWith(
      from,
      to,
      text === '' ? [] : state.schema.text(text),
    )
    dispatch(transaction)
  }

  /** The textarea's own edit path: write, then repaint without waiting. */
  #commitSource(): void {
    this.#writeSource(this.#textarea.value)
    void this.#paint()
  }
```

Replace the existing `#paint` method —

```ts
  async #paint(): Promise<void> {
    const token = (this.#renderToken += 1)
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    const result = await this.renderer.render(language, this.#node.textContent)
    if (token !== this.#renderToken) return

    if (result.ok) {
      this.#render.innerHTML = result.markup
      this.#error.hidden = true
      this.#fitDiagram()
      return
    }

    // Fail visibly and locally: keep the source reachable and show the parser's
    // own message rather than an empty frame.
    this.#render.replaceChildren()
    this.#error.hidden = false
    this.#error.textContent = result.message
  }
```

with:

```ts
  /** Renders the node's current content and paints the result. Returns it so callers — the fix-it loop — can inspect success without a second render. */
  async #paint(): Promise<RenderedDiagram> {
    const token = (this.#renderToken += 1)
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    const result = await this.renderer.render(language, this.#node.textContent)
    if (token !== this.#renderToken) return result

    if (result.ok) {
      this.#render.innerHTML = result.markup
      this.#error.hidden = true
      this.#fitDiagram()
      return result
    }

    // Fail visibly and locally: keep the source reachable and show the parser's
    // own message rather than an empty frame.
    this.#render.replaceChildren()
    this.#error.hidden = false
    this.#errorMessage.textContent = result.message
    return result
  }
```

- [ ] **Step 5: Add the Copy and Fix-it handlers**

Add these two private methods and one private field to the class, near `#fitDiagram` (order does not matter — group them together after it):

```ts
  static readonly #MAX_FIX_ATTEMPTS = 3

  /** Set in `destroy()`; stops the fix-it loop from writing into a torn-down block. */
  #destroyed = false

  async #copyError(): Promise<void> {
    if (this.clipboard === undefined) return
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'
    const text = formatDiagramErrorForCopy(language, this.#textarea.value, this.#errorMessage.textContent ?? '')
    const ok = await this.clipboard.write({ 'text/plain': text })
    this.#copyButton.textContent = ok ? 'Copied' : 'Copy failed'
    window.setTimeout(() => {
      if (this.#destroyed) return
      this.#copyButton.textContent = 'Copy'
    }, 1500)
  }

  async #runFix(): Promise<void> {
    if (this.diagramFix === undefined || !this.diagramFix.isConfigured()) return
    const language = (this.#node.attrs['language'] as string | undefined) ?? 'mermaid'

    this.#fixButton.disabled = true
    this.#copyButton.disabled = true
    let errorMessage = this.#errorMessage.textContent ?? ''

    for (let attempt = 1; attempt <= DiagramNodeView.#MAX_FIX_ATTEMPTS; attempt += 1) {
      if (this.#destroyed) return
      this.#fixButton.textContent = `Fixing… (${attempt}/${DiagramNodeView.#MAX_FIX_ATTEMPTS})`

      const outcome = await this.diagramFix.fix(language, this.#textarea.value, errorMessage)
      if (this.#destroyed) return

      if (!outcome.ok) {
        // A transport/auth failure, not a syntax error the model could retry.
        // Stop immediately rather than spending the remaining attempts on a
        // request that cannot succeed.
        this.#errorMessage.textContent = outcome.message
        break
      }

      this.#textarea.value = outcome.source
      this.#writeSource(outcome.source)
      const rendered = await this.#paint()
      if (this.#destroyed) return

      if (rendered.ok) {
        this.#fixButton.disabled = false
        this.#copyButton.disabled = false
        this.#fixButton.textContent = 'Fix it'
        return
      }

      errorMessage = rendered.message
      if (attempt === DiagramNodeView.#MAX_FIX_ATTEMPTS) {
        this.#errorMessage.textContent =
          `Couldn't auto-fix after ${DiagramNodeView.#MAX_FIX_ATTEMPTS} attempts. Last error: ${rendered.message}`
      }
    }

    this.#fixButton.disabled = false
    this.#copyButton.disabled = false
    this.#fixButton.textContent = 'Fix it'
  }
```

- [ ] **Step 6: Guard against the fix-it loop outliving the node view**

In the existing `destroy()` method, add `this.#destroyed = true` as its first line:

```ts
  destroy(): void {
    this.#destroyed = true
    this.#renderToken += 1
    this.#scheme?.removeEventListener('change', this.#onSchemeChange)
    this.#sheetHeader.removeEventListener('pointerdown', this.#beginDrag)
    // The sheet lives on <body>, so this listener would outlive the block that
    // owns it if the node is destroyed while the sheet is open.
    document.removeEventListener('keydown', this.#onEscape)
    this.#resize.disconnect()
    this.#sheet.remove()
  }
```

- [ ] **Step 7: Run the unit test to verify it passes**

Run: `npx vitest run tests/adapters/diagram-error-copy-format.test.ts`
Expected: PASS

- [ ] **Step 8: Add CSS for the two buttons and the message block**

In `src/app/styles/app.css`, replace the existing `.diagram-error` rule (`app.css:2755-2764`):

```css
/* A broken diagram shows the parser's own message and keeps its source
   editable. Never a blank rectangle (DESIGN.md §4.4). */
.diagram-error {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--danger);
  border-radius: 9px;
  background: color-mix(in srgb, var(--danger) 9%, var(--paper));
  color: var(--danger);
  font: 11.5px/1.5 var(--mono);
  white-space: pre-wrap;
}
```

with:

```css
/* A broken diagram shows the parser's own message and keeps its source
   editable. Never a blank rectangle (DESIGN.md §4.4). */
.diagram-error {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--danger);
  border-radius: 9px;
  background: color-mix(in srgb, var(--danger) 9%, var(--paper));
  color: var(--danger);
  font: 11.5px/1.5 var(--mono);
}

.diagram-error-message {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
}

.diagram-error-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.diagram-error-actions button {
  padding: 3px 9px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  background: var(--paper);
  color: var(--danger);
  font: 600 11px/1.4 var(--sans);
  cursor: pointer;
}

.diagram-error-actions button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 14%, var(--paper));
}

.diagram-error-actions button:disabled {
  opacity: 0.55;
  cursor: default;
}
```

- [ ] **Step 9: Typecheck and run the full unit suite**

Run: `npm run typecheck && npx vitest run`
Expected: no errors; all tests pass

- [ ] **Step 10: Commit**

```bash
git add src/adapters/editor/diagram-node-view.ts src/app/styles/app.css tests/adapters/diagram-error-copy-format.test.ts
git commit -m "feat: add Copy and Fix-it buttons to the diagram error box"
```

---

### Task 6: Settings panel and native menu entry

**Files:**
- Create: `src/app/ui/settings-panel.ts`
- Modify: `src/app/ui/native-menu.ts` (`NativeMenuOptions`, `native-menu.ts:23-40`; insert a menu item in the App submenu, `native-menu.ts:192-201`)
- Modify: `src/app/tauri.ts` (instantiate the panel once, mount it, pass `openSettings` into `installNativeMenu`)
- Modify: `src/app/styles/app.css` (new `.settings-*` rules)

**Interfaces:**
- Consumes: `loadAiSettings`, `saveAiSettings`, `normaliseAiSettings` (Task 1).
- Produces: `createSettingsPanel(options: { storage: Pick<Storage,'getItem'|'setItem'> }): { element: HTMLElement; open(): void; close(): void; toggle(): void }`.

- [ ] **Step 1: Write the settings panel module**

```ts
// src/app/ui/settings-panel.ts
import { loadAiSettings, normaliseAiSettings, saveAiSettings } from '../ai-settings.js'

export interface SettingsPanel {
  readonly element: HTMLElement
  open(): void
  close(): void
  toggle(): void
}

export interface SettingsPanelOptions {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
}

function field(label: string, type: string, placeholder: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('label')
  row.className = 'settings-field'
  const name = document.createElement('span')
  name.className = 'settings-field-label'
  name.textContent = label
  const input = document.createElement('input')
  input.type = type
  input.placeholder = placeholder
  input.spellcheck = false
  input.autocomplete = 'off'
  row.append(name, input)
  return { row, input }
}

/**
 * The app's one Settings surface today: the AI diagram fix-it credentials.
 *
 * A centred overlay rather than the "Aa" popover's floating-aside style —
 * this is a form the user fills in once, not something read while editing,
 * so it earns the modal attention a popover deliberately avoids.
 */
export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanel {
  const overlay = document.createElement('div')
  overlay.className = 'settings-overlay'
  overlay.hidden = true

  const panel = document.createElement('section')
  panel.className = 'settings-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Settings')

  const header = document.createElement('header')
  header.className = 'settings-header'
  const title = document.createElement('span')
  title.className = 'settings-title'
  title.textContent = 'Settings'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'settings-close'
  close.textContent = '✕'
  close.title = 'Close (Esc)'
  close.setAttribute('aria-label', 'Close settings')
  close.addEventListener('click', (event) => {
    event.preventDefault()
    closePanel()
  })
  header.append(title, close)

  const body = document.createElement('div')
  body.className = 'settings-body'

  const sectionTitle = document.createElement('h3')
  sectionTitle.textContent = 'AI diagram fix'
  const sectionHint = document.createElement('p')
  sectionHint.className = 'settings-hint'
  sectionHint.textContent =
    'Used by the "Fix it" button on a broken diagram. Stored locally on this device, not encrypted.'

  const apiKeyField = field('API key', 'password', 'sk-…')
  const baseUrlField = field('Base URL', 'text', 'https://api.openai.com/v1')
  const modelField = field('Model', 'text', 'e.g. gpt-4o')

  const actions = document.createElement('div')
  actions.className = 'settings-actions'
  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'settings-save'
  save.textContent = 'Save'
  save.addEventListener('click', (event) => {
    event.preventDefault()
    const next = normaliseAiSettings({
      apiKey: apiKeyField.input.value,
      baseUrl: baseUrlField.input.value,
      model: modelField.input.value,
    })
    saveAiSettings(options.storage, next)
    closePanel()
  })
  actions.append(save)

  body.append(sectionTitle, sectionHint, apiKeyField.row, baseUrlField.row, modelField.row, actions)
  panel.append(header, body)
  overlay.append(panel)

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closePanel()
  })

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closePanel()
  }

  function paint(): void {
    const current = loadAiSettings(options.storage)
    apiKeyField.input.value = current.apiKey
    baseUrlField.input.value = current.baseUrl
    modelField.input.value = current.model
  }

  function openPanel(): void {
    paint()
    overlay.hidden = false
    document.addEventListener('keydown', onEscape)
    apiKeyField.input.focus()
  }

  function closePanel(): void {
    overlay.hidden = true
    document.removeEventListener('keydown', onEscape)
  }

  return {
    element: overlay,
    open: openPanel,
    close: closePanel,
    toggle: () => (overlay.hidden ? openPanel() : closePanel()),
  }
}
```

- [ ] **Step 2: Add `openSettings` to `NativeMenuOptions` and insert the menu item**

In `src/app/ui/native-menu.ts`, add one field to `NativeMenuOptions` (`native-menu.ts:23-40`), after `runTextService`:

```ts
  /** Sends a named action through macOS's focused responder chain. */
  readonly runTextService?: (service: MacosTextServiceId) => void
  /** Opens the Settings panel. */
  readonly openSettings?: () => void
```

In the App submenu's `items` array (`native-menu.ts:192-201`), insert a real `MenuItem` between the About item and the following separator:

```ts
      await PredefinedMenuItem.new({
        item: {
          About: {
            name: appName,
            shortVersion: buildNumber(options.provenance),
            credits: describeBuild(options.provenance),
          },
        },
        text: `About ${appName}`,
      }),
      await MenuItem.new({
        id: 'app:settings',
        text: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        action: () => options.openSettings?.(),
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Services' }),
```

(`MenuItem` is already imported at the top of the file — `native-menu.ts:1` — so no import change is needed.)

- [ ] **Step 3: Instantiate and mount the panel once in `tauri.ts`**

Add an import near the other `./ui/` imports:

```ts
import { createSettingsPanel } from './ui/settings-panel.js'
```

Near the other once-per-process singletons already built from `window.localStorage` (alongside `pins`/`folderStore`/`hiddenStore`/`recentStore`/`historyStore`, `tauri.ts:158-162`), add:

```ts
  const settingsPanel = createSettingsPanel({ storage: window.localStorage })
  document.body.append(settingsPanel.element)
```

This must run once, before the first `mount()` call — not inside `mount()` itself, since `mount()` reruns on every note switch and the panel (and any user typing in it) must survive that.

In the `installNativeMenu({ ... })` call (`tauri.ts:954-960`), add:

```ts
  await installNativeMenu({
    run: (command) => app.run(command),
    state: (command) => app.commandState(command),
    openSettings: () => settingsPanel.open(),
    runTextService: (service: MacosTextServiceId) => {
```

- [ ] **Step 4: CSS for the panel**

Add to `src/app/styles/app.css`, near the other floating-surface rules (after the `.diagram-source` rules is a reasonable spot, since it is the closest existing precedent for a centred/escapable overlay):

```css
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(28, 25, 21, 0.32);
}

.settings-overlay[hidden] {
  display: none;
}

.settings-panel {
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--paper);
  box-shadow: 0 18px 52px rgba(28, 25, 21, 0.24);
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 12px 16px;
  border-bottom: 1px solid var(--line);
}

.settings-title {
  flex: 1;
  font: 600 13px/1.2 var(--sans);
  color: var(--ink);
}

.settings-close {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-2);
  font: 12px/1 var(--sans);
  cursor: pointer;
}

.settings-close:hover {
  background: var(--line);
  color: var(--ink);
}

.settings-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.settings-body h3 {
  margin: 0;
  font: 600 12px/1.3 var(--sans);
  color: var(--ink);
}

.settings-hint {
  margin: 0;
  font: 11.5px/1.5 var(--sans);
  color: var(--ink-2);
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-field-label {
  font: 600 11px/1.3 var(--sans);
  color: var(--ink-2);
}

.settings-field input {
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--chrome);
  color: var(--ink);
  font: 12.5px/1.4 var(--mono);
}

.settings-field input:focus {
  outline: none;
  border-color: var(--accent);
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.settings-save {
  padding: 6px 16px;
  border: 1px solid var(--accent);
  border-radius: 7px;
  background: var(--accent);
  color: var(--paper);
  font: 600 12px/1.3 var(--sans);
  cursor: pointer;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Manual verification in the packaged app**

This cannot run in vitest or Playwright — `installNativeMenu` drives the real macOS menu API and only exists once the app is built and installed (same reasoning `docs/superpowers/specs/2026-08-05-vega-lite-renderer-design.md` §3 gives for its own packaged-build-only row). Build and install the app, then confirm:
1. `SimpleMark` menu shows a `Settings…` item with the `⌘,` shortcut, directly below About.
2. Clicking it opens the panel centred over the window; typing a key/URL/model and clicking Save persists it (reopening Settings shows the same values); pressing Escape or clicking outside the panel closes it without discarding what was already saved on a previous Save.

- [ ] **Step 7: Commit**

```bash
git add src/app/ui/settings-panel.ts src/app/ui/native-menu.ts src/app/tauri.ts src/app/styles/app.css
git commit -m "feat: add Settings panel with a native menu entry"
```

---

### Task 7: End-to-end coverage for the fix-it retry loop and the copy button

**Files:**
- Create: `tests/ui/diagram-fix-it.spec.ts`

**Interfaces:**
- Consumes: the app's `page.route()`-interceptable `fetch('.../chat/completions')` call from the browser transport (Task 4), and `simplemark.ai-settings` / diagram source seeded via `localStorage` before navigation (Task 1's storage key).

- [ ] **Step 1: Write the spec**

```ts
// tests/ui/diagram-fix-it.spec.ts
import { expect, test } from '@playwright/test'

/**
 * The diagram-error box's Copy and Fix-it buttons (EDITOR error-recovery).
 *
 * Fix-it drives the real retry loop against a routed-and-stubbed
 * `/chat/completions` endpoint — no test-only seam in app code, the same way
 * clipboard-exports.spec.ts drives the real clipboard port rather than a
 * fake one.
 */

const EDITOR = '.milkdown .ProseMirror'
const BROKEN_MERMAID = 'flowchart TD\n  Start(["Begin<br/>(also broken"]'
const FIXED_MERMAID = 'flowchart TD\n  Start["Begin"]'

const AI_SETTINGS = { apiKey: 'sk-test', baseUrl: 'https://ai-fix.test/v1', model: 'gpt-4o' }

function chatCompletionResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

async function openNoteWithBrokenDiagram(page: import('@playwright/test').Page): Promise<void> {
  const body = `# Note\n\n\`\`\`mermaid\n${BROKEN_MERMAID}\n\`\`\`\n`
  await page.addInitScript(
    ({ content, settings }: { content: string; settings: typeof AI_SETTINGS }) => {
      window.localStorage.setItem('simplemark.ai-settings', JSON.stringify(settings))
      window.showOpenFilePicker = async () => {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle('diagram-fix.md', { create: true })
        if ((await handle.getFile()).size === 0) {
          const writable = await handle.createWritable()
          await writable.write(content)
          await writable.close()
        }
        return [handle]
      }
    },
    { content: body, settings: AI_SETTINGS },
  )
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.diagram-error')).toBeVisible()
}

test('Copy places the language, error, and source on the clipboard', async ({ page }) => {
  await openNoteWithBrokenDiagram(page)
  await page.locator('.diagram-error-copy').click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Diagram type: mermaid')
  expect(text).toContain(BROKEN_MERMAID)
  expect(text).toContain('```mermaid')
})

test('Fix it retries until the diagram renders, updating the label on every attempt', async ({ page }) => {
  let calls = 0
  await page.route('https://ai-fix.test/v1/chat/completions', async (route) => {
    calls += 1
    // Still-broken syntax on the first two answers, valid on the third —
    // exercises the loop, the live "(N/3)" label, and the eventual success.
    const content = calls < 3 ? `flowchart TD\n  Still["Broken (attempt ${calls}"]` : FIXED_MERMAID
    await route.fulfill({ json: chatCompletionResponse(content) })
  })

  await openNoteWithBrokenDiagram(page)
  const fixButton = page.locator('.diagram-error-fix')
  await fixButton.click()

  await expect(fixButton).toHaveText('Fixing… (1/3)')
  await expect(page.locator(`${EDITOR} .diagram-render svg`).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.diagram-error')).toBeHidden()
  expect(calls).toBe(3)

  const saved = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(saved).toContain(FIXED_MERMAID)
})

test('a transport failure stops the loop immediately instead of spending all 3 attempts', async ({ page }) => {
  let calls = 0
  await page.route('https://ai-fix.test/v1/chat/completions', async (route) => {
    calls += 1
    await route.fulfill({ status: 401, body: 'unauthorized' })
  })

  await openNoteWithBrokenDiagram(page)
  await page.locator('.diagram-error-fix').click()

  await expect(page.locator('.diagram-error-message')).toContainText('401', { timeout: 10_000 })
  expect(calls).toBe(1)
})

test('3 straight syntax-error answers leave the last attempt in the document and give up visibly', async ({ page }) => {
  let calls = 0
  await page.route('https://ai-fix.test/v1/chat/completions', async (route) => {
    calls += 1
    await route.fulfill({ json: chatCompletionResponse(`flowchart TD\n  Still["Broken (attempt ${calls}"]`) })
  })

  await openNoteWithBrokenDiagram(page)
  await page.locator('.diagram-error-fix').click()

  await expect(page.locator('.diagram-error-message')).toContainText("Couldn't auto-fix after 3 attempts", {
    timeout: 15_000,
  })
  expect(calls).toBe(3)

  const saved = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(saved).toContain('attempt 3')
})
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/ui/diagram-fix-it.spec.ts`
Expected: PASS, all 4 tests

- [ ] **Step 3: Run the full suite once**

Run: `npm run typecheck && npx vitest run && npx playwright test`
Expected: everything passes — this is the final integration check across all six prior tasks

- [ ] **Step 4: Commit**

```bash
git add tests/ui/diagram-fix-it.spec.ts
git commit -m "test: cover the diagram fix-it retry loop and copy button end to end"
```
