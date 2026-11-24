import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PageModel, Span, TemplateId } from '../model.ts'
import { spansToText } from '../model.ts'

export const PAGE_W = 1080
export const PAGE_H = 1440

export type BrandTheme = 'avatar-green' | 'navy-gold' | 'gongwen'
export type BrandSize = 'small' | 'standard' | 'large'

const FILE = {
  'avatar-green': 'avatar-green.css',
  'navy-gold': 'navy-gold.css',
  gongwen: 'gongwen.css',
} as const

export function normalizeTheme(theme: string | undefined): BrandTheme {
  if (theme === 'navy-gold' || theme === 'tech') return 'navy-gold'
  if (theme === 'gongwen' || theme === 'opinion') return 'gongwen'
  return 'avatar-green'
}

export function brandDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, '..', 'brand'), join(here, '..', '..', 'brand')]
  return candidates.find(candidate => existsSync(join(candidate, 'dog.png'))) ?? candidates[0]
}

export function themeCss(theme: BrandTheme): string {
  return readFileSync(join(brandDir(), 'themes', FILE[theme]), 'utf8')
}

let dog: string | undefined
export function dogSrc(): string {
  if (dog) return dog
  const bytes = readFileSync(join(brandDir(), 'dog.png'))
  dog = `data:image/png;base64,${bytes.toString('base64')}`
  return dog
}

export function pageDocument(page: PageModel, theme: string, size: BrandSize, index: number, total: number, images: Map<string, string>): string {
  const brand = normalizeTheme(theme)
  const css = `${themeCss(brand)}\n${shotCss()}`
  const inner = pageInner(page, brand, size, index, total, images)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body{margin:0;width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden}${css}</style></head><body>${inner}</body></html>`
}

export function pageInner(page: PageModel, theme: BrandTheme, size: BrandSize, index: number, total: number, images: Map<string, string>): string {
  const dog = theme === 'avatar-green' ? dogSrc() : ''
  if (theme === 'gongwen') return gongwenPage(page, size, index, total)
  return cardPage(page, size, index, total, dog, images)
}

function cardPage(page: PageModel, size: BrandSize, index: number, total: number, dog: string, images: Map<string, string>): string {
  const n = String(index + 1).padStart(2, '0')
  const pages = String(total).padStart(2, '0')
  const hasDog = dog ? ' has-dog' : ''
  if (page.role === 'cover') {
    return `<section class="page cover size-${size}${hasDog}">
      <div class="frame">
        <div class="cover-top"><div class="cover-badge">考公面试干货</div><div class="cover-vol">${n} / ${pages}</div></div>
        <div class="cover-main">
          <div class="cover-hero">
            <div class="cover-copy">
              <div class="cover-kicker">${escapeHtml(page.kicker || '面试方法论')}</div>
              <div class="cover-title">${escapeHtml(page.title)}</div>
              <div class="cover-sub">${escapeHtml(lead(page))}</div>
            </div>
            ${dog ? `<img class="cover-dog" alt="" src="${dog}">` : ''}
          </div>
          <div class="cover-rule"></div>
          <div class="cover-lead">${escapeHtml(quoteText(page) || lead(page))}</div>
        </div>
        <div class="cover-bottom"><div class="author">一个路人甲<span class="role">自学面试上岸</span></div><div class="cover-pg">${n} / ${pages}</div></div>
      </div>
    </section>`
  }
  const body = page.blocks.map(block => blockHtml(block, images)).join('')
  return `<section class="page size-${size}${hasDog}">
    <div class="frame">
      <div class="topbar"><span class="series">结构化面试 · 地基</span><span>${n} / ${pages}</span></div>
      <div class="content">
        <div class="sec-kicker">${escapeHtml(page.kicker || '内页')}</div>
        <h1>${escapeHtml(page.title)}</h1>
        <div class="rule"></div>
        <div class="prose">${body}</div>
      </div>
      <div class="footer"><div class="footer-author">一个路人甲</div>${dog ? `<img class="footer-dog" alt="" src="${dog}">` : ''}<div class="pg">${n}</div></div>
    </div>
  </section>`
}

function gongwenPage(page: PageModel, size: BrandSize, index: number, total: number): string {
  const body = page.blocks.filter(block => block.type !== 'image').map(block => {
    if (block.type === 'quote') return `<p class="quote"><strong>${escapeHtml(block.text ?? '')}</strong></p>`
    return `<p>${spansHtml(block.spans, block.text ?? '')}</p>`
  }).join('')
  const title = index === 0 ? `<h1 class="doc-title">${escapeHtml(page.title)}</h1><div class="doc-author">一个路人甲</div>` : `<h2>${escapeHtml(page.title)}</h2>`
  return `<section class="page size-${size}">
    <div class="paper"><div class="doc">${title}${body}</div><div class="footer"><div class="pg">— ${index + 1} —</div></div></div>
  </section>`
}

function blockHtml(block: PageModel['blocks'][number], images: Map<string, string>): string {
  if (block.type === 'quote') return `<blockquote class="pull">${escapeHtml(block.text ?? '')}</blockquote>`
  if (block.type === 'image' && block.assetId) {
    const src = images.get(block.assetId) || `/api/personal-media-studio/asset?id=${encodeURIComponent(block.assetId)}`
    const crop = block.crop ?? { x: 50, y: 50, scale: 1 }
    const shiftX = ((crop.x - 50) * 0.7).toFixed(2)
    const shiftY = ((crop.y - 50) * 0.7).toFixed(2)
    return `<figure class="shot"><div class="shot-stage"><img alt="${escapeHtml(block.caption || '')}" src="${src}" style="transform:translate(${shiftX}%,${shiftY}%) scale(${crop.scale})"></div><figcaption>${escapeHtml(block.caption || '')}</figcaption></figure>`
  }
  return `<p>${spansHtml(block.spans, block.text ?? '')}</p>`
}

function spansHtml(spans: Span[] | undefined, fallback: string): string {
  const source = spans?.length ? spans : [{ text: fallback }]
  return source.map(span => {
    let html = escapeHtml(span.text)
    if (span.bold || span.highlight) html = `<span class="hl">${html}</span>`
    return html
  }).join('')
}

function lead(page: PageModel): string {
  const paragraph = page.blocks.find(block => block.type === 'paragraph')
  return spansToText(paragraph?.spans, paragraph?.text ?? '')
}

function quoteText(page: PageModel): string {
  return page.blocks.find(block => block.type === 'quote')?.text ?? ''
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

export function shotCss(): string {
  return `.shot{margin:12px 0 0}.shot-stage{height:420px;border-radius:16px;overflow:hidden;background:rgba(0,0,0,.04);border:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:center}.shot-stage img{width:100%;height:100%;object-fit:contain;object-position:center;transform-origin:center center}.shot figcaption{margin-top:8px;font-size:22px;color:var(--muted,#667066)}`
}

export type { TemplateId }
