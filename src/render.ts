import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { Block, PageModel, Span, TemplateId } from './model.ts'
import { spansToText } from './model.ts'

export const PAGE_W = 1242
export const PAGE_H = 1660

const THEMES: Record<TemplateId, { paper: string, ink: string, muted: string, accent: string, font: string, quoteBg: string }> = {
  knowledge: {
    paper: '#f6f1e7',
    ink: '#1c1917',
    muted: '#6f655b',
    accent: '#c4552a',
    font: '"Songti SC","Noto Serif CJK SC","Source Han Serif SC","WenQuanYi Micro Hei",serif',
    quoteBg: '#efe4d4',
  },
  tech: {
    paper: '#0b1220',
    ink: '#e7eefc',
    muted: '#93a4c3',
    accent: '#3ee0c5',
    font: '"Segoe UI","PingFang SC","WenQuanYi Micro Hei",sans-serif',
    quoteBg: '#132033',
  },
  opinion: {
    paper: '#fff7f2',
    ink: '#3b2416',
    muted: '#8d6758',
    accent: '#d4533a',
    font: '"PingFang SC","WenQuanYi Micro Hei","Noto Sans CJK SC",sans-serif',
    quoteBg: '#ffe8df',
  },
}

export interface RenderAsset {
  id: string
  absPath: string
  title: string
}

export function renderPageHtml(page: PageModel, template: TemplateId, assets: RenderAsset[]): string {
  const theme = THEMES[template] ?? THEMES.knowledge
  const background = page.style.background || theme.paper
  const accent = page.style.accent || theme.accent
  const titleSize = page.style.titleSize ?? (page.role === 'cover' ? 68 : 56)
  const bodySize = page.style.bodySize ?? 36
  const images = new Map(assets.map(asset => [asset.id, asset]))
  const body = page.blocks.map(block => renderBlock(block, images, bodySize)).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: ${PAGE_W}px; height: ${PAGE_H}px; overflow: hidden; background: ${background}; }
  .page {
    width: ${PAGE_W}px; height: ${PAGE_H}px; box-sizing: border-box;
    padding: 96px 88px; color: ${theme.ink};
    font-family: ${theme.font};
    background: ${background};
    display: flex; flex-direction: column; gap: 28px;
  }
  .kicker { color: ${accent}; letter-spacing: 0.18em; font-size: 26px; font-weight: 700; }
  h1 { margin: 0; font-size: ${titleSize}px; line-height: 1.18; font-weight: 700; letter-spacing: -0.02em; }
  .paragraph { margin: 0; font-size: ${bodySize}px; line-height: 1.65; }
  strong { font-weight: 800; }
  mark { background: ${accent}33; color: inherit; padding: 0 0.12em; }
  .quote {
    background: ${theme.quoteBg}; color: ${theme.ink};
    padding: 36px 40px; font-size: 42px; line-height: 1.45; border-left: 10px solid ${accent};
  }
  figure { margin: 8px 0 0; }
  img { width: 100%; height: 420px; object-fit: cover; border-radius: 18px; display: block; background: ${theme.quoteBg}; }
  figcaption { color: ${theme.muted}; font-size: 24px; margin-top: 12px; }
  .rule { height: 1px; background: ${accent}; opacity: 0.45; }
</style>
</head>
<body>
<article class="page">
  <div class="kicker">${escapeHtml(page.kicker)}</div>
  <h1>${escapeHtml(page.title)}</h1>
  <div class="rule"></div>
  ${body}
</article>
</body>
</html>`
}

function renderBlock(block: Block, images: Map<string, RenderAsset>, bodySize: number): string {
  if (block.type === 'image' && block.assetId) {
    const asset = images.get(block.assetId)
    if (!asset) return `<p class="paragraph">素材缺失</p>`
    const crop = block.crop ?? { x: 50, y: 50, scale: 1 }
    const src = dataUrl(asset.absPath)
    return `<figure><img alt="${escapeHtml(asset.title)}" src="${src}" style="object-position:${crop.x}% ${crop.y}%; transform: scale(${crop.scale}); transform-origin: center;" /><figcaption>${escapeHtml(block.caption || asset.title)}</figcaption></figure>`
  }
  if (block.type === 'quote') {
    return `<blockquote class="quote">${escapeHtml(block.text ?? spansToText(block.spans))}</blockquote>`
  }
  if (block.type === 'heading') {
    return `<h1 style="font-size:${Math.round(bodySize * 1.35)}px">${escapeHtml(block.text ?? '')}</h1>`
  }
  return `<p class="paragraph">${renderSpans(block.spans ?? [{ text: block.text ?? '' }])}</p>`
}

function renderSpans(spans: Span[]): string {
  return spans.map(span => {
    let html = escapeHtml(span.text)
    if (span.highlight) html = `<mark>${html}</mark>`
    if (span.bold) html = `<strong>${html}</strong>`
    return html
  }).join('')
}

export function renderPageSvg(page: PageModel, template: TemplateId, assets: RenderAsset[]): string {
  const theme = THEMES[template] ?? THEMES.knowledge
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
  lines.push(`<rect x="88" y="${y}" width="180" height="6" fill="${accent}" />`)
  y += 64
  for (const block of page.blocks) {
    if (block.type === 'image' && block.assetId) {
      const asset = assets.find(item => item.id === block.assetId)
      if (asset && y < 1400) {
        const href = dataUrl(asset.absPath)
        lines.push(`<image href="${href}" x="88" y="${y}" width="1066" height="460" preserveAspectRatio="xMidYMid slice" />`)
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

export async function renderPagePng(page: PageModel, template: TemplateId, assets: RenderAsset[], engine: 'auto' | 'playwright' | 'sharp'): Promise<{ png: Buffer, engine: 'playwright' | 'sharp' }> {
  if (engine !== 'sharp') {
    try {
      const png = await renderWithPlaywright(renderPageHtml(page, template, assets))
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
