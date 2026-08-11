import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env['SIMPLEMARK_TEST_PORT'] ?? '5273')
const baseURL = `http://127.0.0.1:${port}`
const configuredCiWorkers = Number(process.env['PLAYWRIGHT_WORKERS'] ?? '8')
const ciWorkers = Number.isInteger(configuredCiWorkers) && configuredCiWorkers > 0 ? configuredCiWorkers : 8
const workerConfig = process.env['CI'] === 'true' ? { workers: ciWorkers } : {}
const configuredBrowser = process.env['SIMPLEMARK_TEST_BROWSER'] ?? 'chromium'
if (configuredBrowser !== 'chromium' && configuredBrowser !== 'webkit') {
  throw new Error(`SIMPLEMARK_TEST_BROWSER must be chromium or webkit, received ${configuredBrowser}`)
}
const browserDevice = configuredBrowser === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'

/**
 * UI validation for the browser development shell.
 *
 * `npm run test:ui` is the project's UI gate — the command a project-scoped
 * validation policy should point at. It builds nothing itself: it starts the
 * Vite dev server, which serves the same modules the Tauri shell will load.
 *
 * `forbidOnly` and `retries: 0` are deliberate. A retried UI test hides a flake,
 * and a flake here is evidence the editor integration is wrong.
 */
export default defineConfig({
  testDir: 'tests/ui',
  outputDir: '.artifacts/playwright',
  // Keep each spec's editor setup serial; independent spec files run in parallel
  // through the CI worker pool without sharing a page's mutable document state.
  fullyParallel: false,
  forbidOnly: process.env['CI'] === 'true',
  retries: 0,
  // ADR 0009: correctness waits get CI headroom at the framework level.
  // Saturated shared runners run 2–3× slower than a developer machine; a
  // widened wait can hide no bug because the assertion still demands the same
  // end state, while a 30.9s honest run against the 30s default dequeues a PR.
  // Local runs keep Playwright's tight defaults. Perf guards do NOT inherit
  // this headroom — they use tests/ui/perf-budget.ts explicitly.
  ...(process.env['CI'] === 'true' ? { timeout: 60_000, expect: { timeout: 15_000 } } : {}),
  ...workerConfig,
  reporter: process.env['CI'] === 'true' ? [['list'], ['json', { outputFile: '.artifacts/ui-playwright-receipt.json' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Chromium remains the canonical gate. BUG-8 can additionally run an exact
  // paste regression through Playwright WebKit, the engine family used by the
  // native WKWebView shell, without doubling every CI run.
  projects: [{ name: configuredBrowser, use: { ...devices[browserDevice] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: process.env['CI'] !== 'true',
    timeout: 120_000,
  },
})
