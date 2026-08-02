import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const output = '.artifacts/paste-demo-frames'
const editor = '.milkdown .ProseMirror'

await mkdir(output, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

async function openDemo() {
  await page.goto(process.env.SIMPLEMARK_DEMO_URL ?? 'http://127.0.0.1:5273')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.locator(editor).waitFor()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
}

async function frame(name) {
  await page.screenshot({ path: `${output}/${name}.png` })
}

async function pasteAtEnd(text) {
  await page.bringToFront()
  await page.locator(`${editor} p`).last().click()
  await page.evaluate((clipboardText) => navigator.clipboard.writeText(clipboardText), text)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')
}

await openDemo()
await frame('01-start')

await openDemo()
await pasteAtEnd('## Pasted from a README\n\n- clean Markdown\n- **real formatting**\n- portable source')
await page.getByText('Pasted from a README').scrollIntoViewIfNeeded()
await frame('02-markdown')

await openDemo()
await pasteAtEnd('flowchart LR\n  PASTE[Paste Mermaid] --> RENDER[It renders]')
const mermaid = page.locator('.diagram').last()
await mermaid.locator('.diagram-render svg').waitFor()
await mermaid.scrollIntoViewIfNeeded()
await frame('03-mermaid')

await openDemo()
await pasteAtEnd(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120">' +
    '<rect width="360" height="120" rx="24" fill="#e4f3ef"/>' +
    '<circle cx="70" cy="60" r="27" fill="#438b79"/>' +
    '<path d="M58 60l9 9 18-21" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<text x="120" y="69" fill="#173d34" font-family="Georgia, serif" font-size="27">Raw SVG, rendered</text>' +
  '</svg>',
)
const svg = page.locator('.diagram').last()
await svg.locator('.diagram-render svg').waitFor()
await svg.scrollIntoViewIfNeeded()
await frame('04-svg')

await browser.close()
