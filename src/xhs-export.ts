import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface EditorState {
  markdown: string
  theme: 'v1' | 'v2' | 'v3'
  size: 'small' | 'standard' | 'large'
  cover_title: string
  subtitle: string
  author: string
  role: string
  cover_kicker: string
  badge: string
  series: string
}

export function editorHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, '../editor/xhs-editor.html'), join(here, '../../editor/xhs-editor.html')]
  for (const file of candidates) {
    try { return readFileSync(file, 'utf8') } catch { /* try the next location */ }
  }
  throw new Error('找不到小红书编辑器页面')
}

export async function renderEditorPngs(state: EditorState): Promise<Buffer[]> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PMS_CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await page.setContent(editorHtml(), { waitUntil: 'load' })
    await page.evaluate(async (next) => {
      const embed = (window as unknown as { XHS_EMBED?: { applyState: (state: EditorState) => void } }).XHS_EMBED
      if (!embed) throw new Error('编辑器没有准备好')
      embed.applyState(next)
      await document.fonts.ready
    }, state)
    const count = await page.locator('#deck .page').count()
    if (count === 0) throw new Error('这篇稿没有排出页面')
    const pngs: Buffer[] = []
    for (let index = 0; index < count; index++) {
      pngs.push(await page.locator('#deck .page').nth(index).screenshot({ type: 'png' }))
    }
    return pngs
  } finally {
    await browser.close()
  }
}
