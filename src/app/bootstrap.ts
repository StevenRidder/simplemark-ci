import type { FilePort } from '../application/ports.js'

/**
 * The composition contract shared by every shell.
 *
 * ADR-0001: `app` is the only composition root, and the browser and Tauri
 * entrypoints compose the *same* document session, editor, renderer, and UI
 * modules. Each shell supplies its own platform ports here and nothing else —
 * "no document or editor rule may live only in the browser entrypoint".
 *
 * Only the file port exists so far. The editor, renderer, and MCP ports join
 * this interface as EDITOR-1, APP-1, and the live-agent deliverable land.
 */
export interface AppPorts {
  readonly file: FilePort
}
