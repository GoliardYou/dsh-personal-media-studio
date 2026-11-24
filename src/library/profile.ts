import { TextDecoder } from 'node:util'
import { win32, posix } from 'node:path'

export type LibraryProfile = 'generic' | 'lurenjia'

/** Student coaching trees and the personal WeChat QR are never indexed. */
export const LURENJIA_EXCLUDES = [
  '**/Coaching_Mindmaps*/**',
  '**/Coaching_Mindmaps*',
  '**/Coaching_Transcription*/**',
  '**/Coaching_Transcription*',
  '**/一个路人甲个人微信二维码.jpg',
]

export const LURENJIA_LIBRARY = 'C:\\Users\\yigel\\一个路人甲小红书素材库'

export const LURENJIA_TOP = [
  'Core_System_核心文字资料',
  'Course_Handouts_视频课程讲义',
  'Goods_Images_商品图片',
  '小红书公众号二维码及商品图片',
  'Deliverables_发布定稿',
  'Commercial_Posters_Exampels_商品笔记示例',
  'Xhs_QA_小红书问答',
  'Archive_归档_发布历史',
  'Coaching_Mindmaps_辅导导图',
  'Coaching_Transcription_辅导转录',
] as const

const PRICE_OR_REFUND = /(?:¥|￥)\s*\d+|\d+(?:\.\d+)?\s*元|退款|全额退|不退|退费|拍下立减/

export function mergeExcludes(profile: LibraryProfile, user: string[]): string[] {
  const extra = profile === 'lurenjia' ? LURENJIA_EXCLUDES : []
  return [...new Set([...extra, ...user])]
}

export function decodeLibraryName(name: string | Buffer): string {
  const text = typeof name === 'string' ? name : decodeBuffer(name)
  return text.replace(/\u200b/g, '').normalize('NFC')
}

function decodeBuffer(buf: Buffer): string {
  const asUtf8 = buf.toString('utf8')
  if (!asUtf8.includes('\uFFFD')) return asUtf8
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return asUtf8
  }
}

/** Keep Windows library roots intact on any host. Does not touch the disk. */
export function normalizeLibraryRoot(input: string): string {
  const stripped = decodeLibraryName(input).trim()
  if (/^[A-Za-z]:[\\/]/.test(stripped) || stripped.includes('\\')) {
    return win32.normalize(stripped.replace(/\//g, '\\'))
  }
  return posix.normalize(stripped)
}

export function excludedPath(rel: string, patterns: string[]): boolean {
  const clean = decodeLibraryName(rel).replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  if (parts.some(part => part === 'node_modules' || part === '.git' || part.startsWith('.'))) return true
  const file = parts[parts.length - 1] ?? ''
  if (file === '一个路人甲个人微信二维码.jpg') return true
  const coaching = parts.some(part => part.startsWith('Coaching_Mindmaps') || part.startsWith('Coaching_Transcription'))
  if (coaching && patterns.some(pattern => pattern.includes('Coaching_Mindmaps') || pattern.includes('Coaching_Transcription'))) return true
  return patterns.some(pattern => globMatch(clean, pattern) || globMatch(file, pattern))
}

function globMatch(value: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, '/')
  let body = '^'
  for (let i = 0; i < normalized.length; i++) {
    if (normalized.startsWith('**/', i)) { body += '(?:.*/)?'; i += 2; continue }
    if (normalized.startsWith('**', i)) { body += '.*'; i += 1; continue }
    if (normalized[i] === '*') { body += '[^/]*'; continue }
    body += /[.+^${}()|[\]\\]/.test(normalized[i]) ? `\\${normalized[i]}` : normalized[i]
  }
  return new RegExp(`${body}$`).test(value)
}

export interface MappedImage {
  image: string
  product: string
  tags: string[]
  uncertain: string[]
}

/** Accept unknown shapes: arrays, filename maps, or `{ images | mapping }` wrappers. */
export function importImageMapping(raw: unknown): MappedImage[] {
  const rows = unwrap(raw)
  const out: MappedImage[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const image = firstString(record, ['image', 'file', 'src', 'path', 'filename', 'name'])
    if (!image) continue
    const product = firstString(record, ['product', 'goods', 'sku', 'title']) ?? ''
    const tags = stringList(record.tags ?? record.tag ?? record.labels)
    const blob = `${image} ${product} ${tags.join(' ')} ${JSON.stringify(record.note ?? record.price ?? '')}`
    const uncertain = PRICE_OR_REFUND.test(blob) ? ['待确认'] : []
    out.push({
      image: decodeLibraryName(image),
      product: uncertain.length ? '' : product,
      tags: uncertain.length ? [...new Set([...tags, '待确认'])] : tags,
      uncertain,
    })
  }
  return out
}

function unwrap(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  for (const key of ['images', 'mapping', 'items', 'data']) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
    if (record[key] && typeof record[key] === 'object') return objectMap(record[key] as Record<string, unknown>)
  }
  return objectMap(record)
}

function objectMap(record: Record<string, unknown>): unknown[] {
  return Object.entries(record).map(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return { image: key, ...(value as object) }
    if (typeof value === 'string') return { image: key, product: value }
    return { image: key }
  })
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,，]/).map(item => item.trim()).filter(Boolean)
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return []
}

export interface CatalogProduct {
  name: string
  summary: string
  price: '待确认'
  how: '待确认'
  uncertain: string[]
}

/** Pull product names from the catalog markdown. Prices are never copied out. */
export function importCatalogMarkdown(markdown: string): CatalogProduct[] {
  const products: CatalogProduct[] = []
  const lines = markdown.split(/\r?\n/)
  let current: CatalogProduct | undefined
  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+)$/)
    if (heading && !/目录|学习路径|封面/.test(heading[1])) {
      current = { name: heading[1].replace(/【待核】|【原图缺失】/g, '').trim(), summary: '', price: '待确认', how: '待确认', uncertain: [] }
      products.push(current)
      continue
    }
    if (!current) continue
    if (PRICE_OR_REFUND.test(line)) {
      current.uncertain.push('待确认')
      continue
    }
    if (line.startsWith('|') || line.startsWith('- ') || line.startsWith('**')) {
      const text = line.replace(/^\|\s*/, '').replace(/\s*\|/g, ' ').replace(/\*\*/g, '').trim()
      if (text && !text.startsWith('---') && current.summary.length < 180) current.summary += (current.summary ? ' ' : '') + text
    }
  }
  return products.filter(item => item.name.length > 0)
}

export type AssetClass = 'review' | 'product-page' | 'qa' | 'published' | 'note' | 'image' | 'other'

export function classifyLibraryPath(rel: string): AssetClass {
  const clean = decodeLibraryName(rel).replace(/\\/g, '/')
  if (clean.includes('好评截图')) return 'review'
  if (clean.includes('pdf_pages') || clean.includes('video_keyframes')) return 'product-page'
  if (clean.includes('Xhs_QA') || clean.includes('小红书问答')) return 'qa'
  if (clean.includes('Archive_归档') || clean.includes('Deliverables_发布定稿')) return 'published'
  if (/\.(png|jpe?g|webp|gif)$/i.test(clean)) return 'image'
  if (/\.(md|markdown|txt)$/i.test(clean)) return 'note'
  return 'other'
}

export function priceWarnings(text: string): string[] {
  return PRICE_OR_REFUND.test(text) ? ['待确认'] : []
}

export function duplicateTopicWarning(title: string, publishedTitles: string[]): string | null {
  const key = title.replace(/\s+/g, '')
  const hit = publishedTitles.find(item => item.replace(/\s+/g, '') === key || item.includes(title) || title.includes(item))
  return hit ? `和已发布「${hit}」撞题，先改角度再写。` : null
}
