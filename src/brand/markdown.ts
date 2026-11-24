export interface MarkdownDraft {
  title: string
  subtitle?: string
  theme?: string
  size?: 'small' | 'standard' | 'large'
  coverTitle?: string
  coverKicker?: string
  badge?: string
  author?: string
  role?: string
  series?: string
  sections: Array<{ heading: string, paragraphs: string[] }>
  quotes?: string[]
  products?: Array<{ name: string, tagline?: string, points?: string[], image?: string, caption?: string }>
  screenshots?: Array<{ src: string, caption?: string }>
}

const THEME_ALIAS: Record<string, string> = {
  knowledge: 'avatar-green',
  tech: 'navy-gold',
  opinion: 'gongwen',
  'avatar-green': 'avatar-green',
  'navy-gold': 'navy-gold',
  gongwen: 'gongwen',
}

/** Markdown that xhs_render.py can consume without edits. Author sentences stay verbatim. */
export function toXhsMarkdown(draft: MarkdownDraft): string {
  const theme = THEME_ALIAS[draft.theme ?? 'avatar-green'] ?? 'avatar-green'
  const front = [
    '---',
    `theme: ${theme}`,
    `size: ${draft.size ?? 'standard'}`,
    `cover_title: ${yaml(draft.coverTitle || draft.title)}`,
    `cover_kicker: ${yaml(draft.coverKicker || '面试方法论')}`,
    `badge: ${yaml(draft.badge || '考公面试干货')}`,
    `author: ${yaml(draft.author || '一个路人甲')}`,
    `role: ${yaml(draft.role || '自学面试上岸')}`,
    `series: ${yaml(draft.series || draft.title)}`,
    `subtitle: ${yaml(draft.subtitle || draft.title)}`,
    '---',
    '',
    `# ${draft.title}`,
    '',
  ]
  const body: string[] = []
  draft.sections.forEach((section, index) => {
    body.push(`## ${section.heading || `第 ${index + 1} 节`}`, '')
    for (const paragraph of section.paragraphs) body.push(paragraph, '')
  })
  for (const quote of draft.quotes ?? []) body.push(`> ${quote}`, '')
  for (const shot of draft.screenshots ?? []) {
    body.push('```screenshot', `src: ${shot.src}`, shot.caption ? `caption: ${shot.caption}` : '', '```', '')
  }
  for (const product of draft.products ?? []) {
    body.push(
      '```product',
      `name: ${product.name}`,
      `tagline: ${product.tagline || product.name}`,
      'points:',
      ...(product.points?.length ? product.points.map(point => `- ${point}`) : ['- 待确认']),
      'price: 待确认',
      'how: 待确认',
      product.image ? `image: ${product.image}` : '',
      product.caption ? `caption: ${product.caption}` : '',
      '```',
      '',
    )
  }
  return [...front, ...body].filter((line, index, all) => !(line === '' && all[index - 1] === '' && all[index + 1] === '')).join('\n').replace(/\n```\n\n/g, '\n```\n') + '\n'
}

function yaml(value: string): string {
  return /[:#]|^\s|\s$/.test(value) ? JSON.stringify(value) : value
}
