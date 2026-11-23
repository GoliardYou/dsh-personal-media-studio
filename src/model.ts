export interface Span {
  text: string
  bold?: boolean
  highlight?: boolean
}

export interface Crop {
  x: number
  y: number
  scale: number
}

export interface Block {
  id: string
  type: 'heading' | 'paragraph' | 'quote' | 'image'
  text?: string
  spans?: Span[]
  assetId?: string
  caption?: string
  crop?: Crop
}

export interface PageStyle {
  background?: string
  accent?: string
  titleSize?: number
  bodySize?: number
}

export interface PageModel {
  id: string
  ordinal: number
  role: 'cover' | 'content' | 'quote'
  kicker: string
  title: string
  blocks: Block[]
  style: PageStyle
}

export type TemplateId = 'knowledge' | 'tech' | 'opinion'

export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  knowledge: '知识分享风',
  tech: '科技专业风',
  opinion: '个人观点风',
}

export function spansToText(spans: Span[] | undefined, fallback = ''): string {
  if (!spans || spans.length === 0) return fallback
  return spans.map(span => span.text).join('')
}

export function textToSpans(text: string, highlights: string[] = []): Span[] {
  if (!text) return [{ text: '' }]
  if (highlights.length === 0) return [{ text }]
  const pattern = highlights.filter(Boolean).sort((a, b) => b.length - a.length)
  let rest = text
  const spans: Span[] = []
  while (rest.length > 0) {
    let hitAt = -1
    let hit = ''
    for (const word of pattern) {
      const index = rest.indexOf(word)
      if (index >= 0 && (hitAt < 0 || index < hitAt)) {
        hitAt = index
        hit = word
      }
    }
    if (hitAt < 0) {
      spans.push({ text: rest })
      break
    }
    if (hitAt > 0) spans.push({ text: rest.slice(0, hitAt) })
    spans.push({ text: hit, bold: true, highlight: true })
    rest = rest.slice(hitAt + hit.length)
  }
  return spans.length > 0 ? spans : [{ text }]
}
