/** Structured notes under Xhs_QA_小红书问答/markdown. Images and tables stay assets. */

export interface ParsedQa {
  title: string
  question: string
  answer: string
  createdAt: string
  sourceFile: string
}

const SKIP_DIR = /^(backup|images)$/i

export function isQaMarkdown(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean)
  const file = parts[parts.length - 1] ?? ''
  if (!/\.md$/i.test(file) && !/\.markdown$/i.test(file)) return false
  if (!parts.some(part => part.includes('Xhs_QA') || part.includes('小红书问答'))) return false
  if (parts.some(part => SKIP_DIR.test(part))) return false
  return true
}

export function parseQaMarkdown(raw: string): ParsedQa | null {
  const text = raw.replace(/^\uFEFF/, '').replace(/\u200b/g, '').replace(/\r\n/g, '\n')
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.replace(/\s+#+\s*$/, '').trim() ?? ''
  const question = extractSection(text, '原始问题')
  const answer = extractSection(text, '回答')
  const meta = extractSection(text, '元信息')
  const createdAt = pickMeta(meta || text, '创建时间')
  const sourceFile = pickMeta(meta || text, '来源文件').replace(/[`*]/g, '')
  const fallback = text
    .replace(/^[\s\S]*?^#\s+.+$/m, '')
    .split(/^##\s/m)[0]
    .replace(/^---\s*$/gm, '')
    .trim()
  const asked = (question || fallback).trim()
  if (!title && !asked) return null
  return {
    title: squash(title || asked).slice(0, 80),
    question: asked || title,
    answer: answer.trim(),
    createdAt,
    sourceFile,
  }
}

function extractSection(text: string, name: string): string {
  const match = text.match(new RegExp(`(?:^|\\n)##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\n---\\s*\\n|$)`))
  return match?.[1]?.replace(/\n---\s*$/g, '').trim() ?? ''
}

function pickMeta(block: string, label: string): string {
  const marked = block.match(new RegExp(`\\*\\*${label}\\*\\*\\s*[:：]\\s*(.+)`))
  if (marked) return marked[1].trim()
  const plain = block.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`))
  return plain?.[1]?.trim() ?? ''
}

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
