/**
 * 原始素材的「空白与断行整理」。
 *
 * 只处理排版层：换行、空格、全角空格、NBSP。
 * 不改字词、不删句子、不补标点、不合并列表项，也不碰用户自己写下的原话。
 */

const LIST_LINE = /^(?:\d+[.、)）]|[-•*·])\s*/
const ASCII_WORD = /[A-Za-z0-9]/

/** 合并两行 OCR 软换行：只有两个 ASCII 词之间才补一个空格。 */
function joinLines(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  const before = left[left.length - 1]
  const after = right[0]
  if (ASCII_WORD.test(before) && ASCII_WORD.test(after)) return `${left} ${right}`
  return `${left}${right}`
}

/** 段内整理：折叠空白、去掉中文之间和中文标点两侧的空白。 */
function tidyInline(value: string): string {
  let next = value.replace(/\u00a0|\u3000/g, ' ').replace(/[ \t]+/g, ' ').trim()
  // 逐轮替换，处理「自 上 手」这类连续空格；用循环而不是单次正则是为避免 lookahead 跳过相邻对。
  let previous = ''
  while (previous !== next) {
    previous = next
    next = next.replace(/([\u3400-\u9fff\uf900-\ufaff])[ \t]+(?=[\u3400-\u9fff\uf900-\ufaff])/g, '$1')
  }
  next = next.replace(/[ \t]+([，。！？；：、）》】」』”’…—])/g, '$1')
  next = next.replace(/([，。！？；：、）》】」』”’…—])[ \t]+/g, '$1')
  next = next.replace(/([（【《「『“‘])[ \t]+/g, '$1')
  return next
}

export function tidySourceText(value: string): string {
  if (!value) return ''
  const normalized = value.replace(/\r\n?/g, '\n').replace(/\u00a0|\u3000/g, ' ')
  const paragraphs = normalized.split(/\n[ \t]*\n+/)
  const result: string[] = []
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    if (lines.length === 0) continue
    if (lines.some(line => LIST_LINE.test(line))) {
      // 列表逐行保留，只整理每一行内部的空白。
      result.push(lines.map(tidyInline).join('\n'))
      continue
    }
    result.push(tidyInline(lines.reduce(joinLines, '')))
  }
  return result.join('\n\n')
}
