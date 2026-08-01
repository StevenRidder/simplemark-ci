import type { AppPorts } from './bootstrap.js'

/**
 * The browser development entrypoint (ADR-0001 §Browser development shell).
 *
 * This is a real product entrypoint, not a throwaway prototype: it is where the
 * browser implementations of the application ports get wired to the same
 * modules the Tauri build loads. It contains platform wiring only.
 *
 * FOUNDATION-1 establishes the location. APP-1 supplies the File System Access
 * port and makes `start` open a real file.
 */
export class EntrypointNotWiredError extends Error {
  override readonly name = 'EntrypointNotWiredError'
}

/**
 * Starts the browser shell.
 *
 * Fails closed until its ports exist. The alternative — returning quietly and
 * rendering nothing — would make an unwired shell indistinguishable from a
 * working one, which is the failure mode the fail-fix-early rule names as a
 * hidden fallback.
 */
export function start(_ports?: AppPorts): never {
  throw new EntrypointNotWiredError(
    'The browser shell has no file port yet. APP-1 supplies the File System Access ' +
      'implementation of FilePort; until then the shell cannot open a document.',
  )
}
