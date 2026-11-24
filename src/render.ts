import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { pageDocument, PAGE_H, PAGE_W, type BrandSize } from './brand/html.ts'
export type { BrandSize }
import type { PageModel } from './model.ts'
import { spansToText } from './model.ts'

export { PAGE_W, PAGE_H }

const PAPERS: Record<string, { paper: string, ink: string, accent: string }> = {
  'avatar-green': { paper: '#F5F6F0', ink: '#1E5A43', accent: '#D4A54A' },
  knowledge: { paper: '#F5F6F0', ink: '#1E5A43', accent: '#D4A54A' },
  'navy-gold': { paper: '#F6F1E8', ink: '#102A3C', accent: '#B8903A' },
  tech: { paper: '#F6F1E8', ink: '#102A3C', accent: '#B8903A' },
  gongwen: { paper: '#FFFFFF', ink: '#000000', accent: '#000000' },
  opinion: { paper: '#FFFFFF', ink: '#000000', accent: '#000000' },
}

export interface RenderAsset {
  id: string
  absPath: string
  title: string
}

export function renderPageHtml(page: PageModel, template: string, assets: RenderAsset[], size: BrandSize = 'standard', index = 0, total = 1, editable = false): string {
  const images = new Map(assets.filter(asset => asset.absPath).map(asset => [asset.id, dataUrl(asset.absPath)]))
  return pageDocument(page, template, size, index, total, images, editable)
}

export function renderPageSvg(page: PageModel, template: string, assets: RenderAsset[]): string {
  const theme = PAPERS[template] ?? PAPERS['avatar-green']
  const background = page.style.background || theme.paper
  const accent = page.style.accent || theme.accent
  const lines: string[] = []
  let y = 160
  lines.push(`<text x="88" y="${y}" fill="${accent}" font-size="28" font-family="WenQuanYi Micro Hei, sans-serif">${escapeXml(page.kicker)}</text>`)
  y += 90
  for (const line of wrap(page.title, page.role === 'cover' ? 12 : 16)) {
    lines.push(`<text x="88" y="${y}" fill="${theme.ink}" font-size="${page.role === 'cover' ? 72 : 56}" font-weight="700" font-family="WenQuanYi Micro Hei, sans-serif">${escapeXml(line)}</text>`)
    y += page.role === 'cover' ? 88 : 72
  }
  y += 20
  lines.push(`<rect x="88" y="${y}" width="180" height="6" fill="${theme.accent}" />`)
  y += 64
  for (const block of page.blocks) {
    if (block.type === 'image' && block.assetId) {
      const asset = assets.find(item => item.id === block.assetId)
      if (asset && y < 1400) {
        const href = dataUrl(asset.absPath)
        lines.push(`<rect x="88" y="${y}" width="900" height="420" rx="20" fill="${theme.paper}" />`)
        lines.push(`<image href="${href}" x="88" y="${y}" width="900" height="420" preserveAspectRatio="xMidYMid meet" />`)
        y += 500
      }
      continue
    }
    const text = block.type === 'quote' ? (block.text ?? '') : spansToText(block.spans, block.text ?? '')
    const size = block.type === 'quote' ? 40 : 32
    const color = block.type === 'quote' ? accent : theme.ink
    for (const line of wrap(text, 24)) {
      if (y > 1560) break
      lines.push(`<text x="88" y="${y}" fill="${color}" font-size="${size}" font-family="WenQuanYi Micro Hei, sans-serif">${escapeXml(line)}</text>`)
      y += size + 22
    }
    y += 16
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
  <rect width="100%" height="100%" fill="${background}" />
  ${lines.join('\n  ')}
</svg>`
}

export async function renderPagePng(page: PageModel, template: string, assets: RenderAsset[], engine: 'auto' | 'playwright' | 'sharp' | 'xhs_render', index = 0, total = 1, size: BrandSize = 'standard'): Promise<{ png: Buffer, engine: 'playwright' | 'sharp' }> {
  if (engine !== 'sharp' && engine !== 'xhs_render') {
    try {
      const png = await renderWithPlaywright(renderPageHtml(page, template, assets, size, index, total))
      return { png, engine: 'playwright' }
    } catch (error) {
      if (engine === 'playwright') throw error
    }
  }
  const sharp = (await import('sharp')).default
  const svg = renderPageSvg(page, template, assets)
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return { png, engine: 'sharp' }
}

async function renderWithPlaywright(html: string): Promise<Buffer> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PMS_CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: PAGE_W, height: PAGE_H }, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: PAGE_W, height: PAGE_H } })
    return png
  } finally {
    await browser.close()
  }
}

function dataUrl(file: string): string {
  const bytes = readFileSync(file)
  const ext = extname(file).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function wrap(text: string, width: number): string[] {
  const chars = Array.from(text.replace(/\s+/g, ''))
  if (chars.length === 0) return []
  const lines: string[] = []
  for (let i = 0; i < chars.length; i += width) lines.push(chars.slice(i, i + width).join(''))
  return lines
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

function escapeXml(value: string): string {
  return escapeHtml(value)
}
