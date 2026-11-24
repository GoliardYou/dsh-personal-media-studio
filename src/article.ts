/** Turn the author's own sentences into one article. Wording stays; only breaks, headings, bold, and quotes are added. */

export function composeArticle(title: string, thoughts: string[], accepted: string[] = []): string {
  const parts: string[] = []
  thoughts.map(item => item.trim()).filter(Boolean).forEach((thought, index) => {
    parts.push(structureThought(thought, index > 0 || thoughts.filter(item => item.trim()).length > 1))
  })
  accepted.map(item => item.trim()).filter(Boolean).forEach(note => {
    parts.push(note)
  })
  const heading = title.trim() || '未命名'
  return `# ${heading}\n\n${parts.filter(Boolean).join('\n\n')}\n`
}

export function wordingOf(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, block => block.replace(/```/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*|==/g, '')
    .replace(/\s+/g, '')
}

function structureThought(text: string, allowHeading: boolean): string {
  if (/^#{1,3}\s/m.test(text)) return text
  const paragraphs = text.split(/\n{2,}/).flatMap(block => splitSentences(block.trim())).filter(Boolean)
  if (paragraphs.length === 0) return ''
  let heading = ''
  const body = paragraphs
  const lead = paragraphs[0] ?? ''
  const clause = (lead.split(/[，,。！？]/)[0] ?? '').trim()
  if (allowHeading && clause.length >= 4 && clause.length <= 16) heading = `## ${clause}`
  return [heading, ...body.map(formatParagraph)].filter(Boolean).join('\n\n')
}

function splitSentences(block: string): string[] {
  if (block.includes('\n')) return [block]
  const sentences = block.split(/(?<=[。！？])/).map(item => item.trim()).filter(Boolean)
  if (sentences.length <= 2) return [block]
  const groups: string[] = []
  for (let index = 0; index < sentences.length; index += 2) {
    groups.push(sentences.slice(index, index + 2).join(''))
  }
  return groups
}

function formatParagraph(paragraph: string): string {
  const trimmed = paragraph.trim()
  const quoted = trimmed.match(/^「([^」]{4,80})」$/)
  if (quoted) return `> ${quoted[1]}`
  if (/\*\*|^>\s|==/.test(trimmed)) return trimmed
  const sentences = trimmed.split(/(?<=[。！？])/).map(item => item.trim()).filter(Boolean)
  const candidate = sentences
    .filter(sentence => sentence.length >= 8 && sentence.length <= 42 && /是|要|不|会/.test(sentence))
    .sort((a, b) => a.length - b.length)[0]
  if (!candidate) return trimmed
  return trimmed.replace(candidate, `**${candidate}**`)
}
