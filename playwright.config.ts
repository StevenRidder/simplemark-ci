import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env['SIMPLEMARK_TEST_PORT'] ?? '5273')
const baseURL = `http://127.0.0.1:${port}`

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
  fullyParallel: false,
  forbidOnly: process.env['CI'] === 'true',
  retries: 0,
  reporter: process.env['CI'] === 'true' ? [['list'], ['json', { outputFile: '.artifacts/ui-playwright-receipt.json' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: process.env['CI'] !== 'true',
    timeout: 120_000,
  },
})
