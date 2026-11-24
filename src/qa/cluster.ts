import { createHash } from 'node:crypto'
import type { ParsedQa } from './parse.ts'

export interface QaNote extends ParsedQa {
  id: string
  assetId: string
  relPath: string
  sourceAssetId: string | null
}

export interface QaCluster {
  key: string
  title: string
  members: QaNote[]
  representative: QaNote
  questions: QaNote[]
  answer: string
  newest: string
  published: boolean
  score: number
}

const STOP = new Set([
  '的', '了', '吗', '呢', '吧', '啊', '呀', '么', '呢',
  '怎么', '什么', '如何', '可以', '这个', '那个', '一个', '我们', '你们', '他们',
  '老师', '同学', '请问', '一下', '还是', '是不是', '要不要', '能不能', '会不会',
  '这样', '这么', '那么', '因为', '所以', '如果', '但是', '然后', '就是', '不是',
  '有没有', '为什么', '怎么办', '怎么样', '哪些', '哪里', '一下', '真的', '感觉',
])

const NEAR_DUP = 0.86
const THEME = 0.33

export function clusterQuestions(notes: QaNote[], now = Date.now()): QaCluster[] {
  if (notes.length === 0) return []
  const docs = notes.map(note => `${note.title}\n${note.title}\n${note.title}\n${note.question}`)
  const df = new Map<string, number>()
  const gramSets = docs.map(doc => {
    const counts = countGrams(doc)
    for (const gram of counts.keys()) df.set(gram, (df.get(gram) ?? 0) + 1)
    return counts
  })
  const vectors = gramSets.map(counts => weigh(counts, df, notes.length))
  const parent = notes.map((_, index) => index)
  const find = (index: number): number => {
    let cursor = index
    while (parent[cursor] !== cursor) cursor = parent[cursor]
    let reset = index
    while (parent[reset] !== cursor) {
      const next = parent[reset]
      parent[reset] = cursor
      reset = next
    }
    return cursor
  }
  const unite = (left: number, right: number) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent[b] = a
  }
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      if (normalizeQuestion(notes[i].question) === normalizeQuestion(notes[j].question) || cosine(vectors[i], vectors[j]) >= NEAR_DUP) {
        unite(i, j)
      }
    }
  }
  const groups = new Map<number, number[]>()
  notes.forEach((_, index) => {
    const root = find(index)
    const list = groups.get(root) ?? []
    list.push(index)
    groups.set(root, list)
  })
  const bundled = [...groups.values()].map(indexes => ({
    indexes,
    vector: centroid(indexes.map(index => vectors[index])),
    newest: indexes.map(index => notes[index].createdAt).sort().at(-1) ?? '',
  })).sort((a, b) => b.indexes.length - a.indexes.length || b.newest.localeCompare(a.newest))

  const themes: Array<{ indexes: number[], vector: Map<string, number> }> = []
  for (const group of bundled) {
    let best = -1
    let bestScore = THEME
    themes.forEach((theme, index) => {
      const score = cosine(group.vector, theme.vector)
      if (score >= bestScore) {
        best = index
        bestScore = score
      }
    })
    if (best >= 0) {
      themes[best].indexes.push(...group.indexes)
      themes[best].vector = centroid(themes[best].indexes.map(index => vectors[index]))
    } else {
      themes.push({ indexes: [...group.indexes], vector: group.vector })
    }
  }

  return themes.map(theme => {
    const members = theme.indexes.map(index => notes[index])
    const representative = pickRepresentative(members, theme.indexes, vectors)
    const questions = pickQuestions(members, representative)
    const answer = representative.answer.trim() || members.map(note => note.answer.trim()).find(Boolean) || ''
    const newest = members.map(note => note.createdAt).filter(Boolean).sort().at(-1) ?? ''
    const ageDays = newest ? Math.max(0, (now - Date.parse(newest.replace(' ', 'T'))) / 86_400_000) : 3650
    const recency = Number.isFinite(ageDays) ? 4 / (1 + ageDays / 30) : 0
    return {
      key: createHash('sha1').update(members.map(note => note.assetId).sort().join('|')).digest('hex').slice(0, 20),
      title: clusterTitle(representative),
      members,
      representative,
      questions,
      answer,
      newest,
      published: false,
      score: members.length + recency,
    }
  })
}

export function markPublished(clusters: QaCluster[], publishedTexts: string[]) {
  const docs = publishedTexts.map(text => text.trim()).filter(text => text.length >= 4)
  const df = new Map<string, number>()
  const vectors = docs.map(doc => {
    const counts = countGrams(doc)
    for (const gram of counts.keys()) df.set(gram, (df.get(gram) ?? 0) + 1)
    return counts
  }).map(counts => weigh(counts, df, Math.max(docs.length, 1)))
  for (const cluster of clusters) {
    const title = cluster.title.replace(/\s+/g, '')
    const textual = docs.some(doc => {
      const other = doc.replace(/\s+/g, '')
      return other.includes(title) || title.includes(other)
    })
    const probe = weigh(countGrams(`${cluster.title}\n${cluster.representative.question}`), df, Math.max(docs.length, 1))
    cluster.published = textual || vectors.some(vector => cosine(probe, vector) >= 0.72)
  }
}

export function selectBoard(clusters: QaCluster[], maxCards: number): { board: QaCluster[], pool: QaCluster[] } {
  const cap = Number.isFinite(maxCards) ? Math.max(0, Math.min(48, Math.floor(maxCards))) : 12
  const ranked = [...clusters].sort((a, b) => b.score - a.score || b.newest.localeCompare(a.newest) || a.title.localeCompare(b.title, 'zh'))
  const board = ranked.filter(cluster => !cluster.published).slice(0, cap)
  const chosen = new Set(board)
  return { board, pool: ranked.filter(cluster => !chosen.has(cluster)) }
}

export function formatClusterBody(cluster: QaCluster): string {
  const lines = [
    `有 ${cluster.members.length} 位同学问过这个方向。${cluster.newest ? `最近一条是 ${cluster.newest.slice(0, 16)}。` : ''}`,
    '原问题：',
    ...cluster.questions.map((note, index) => `${index + 1}. ${squash(note.question).slice(0, 80)}`),
    `已有回答：${squash(cluster.answer).slice(0, 280) || '（这批笔记里没有写下回答）'}`,
  ]
  if (cluster.representative.sourceFile) lines.push(`来源截图：${cluster.representative.sourceFile}`)
  if (cluster.published) lines.push('已在发布记录里出现过，这次不放到看板上。')
  return lines.join('\n')
}

function pickRepresentative(members: QaNote[], indexes: number[], vectors: Array<Map<string, number>>): QaNote {
  let best = members[0]
  let bestScore = -Infinity
  members.forEach((member, offset) => {
    const vector = vectors[indexes[offset]]
    const closeness = members.reduce((sum, _, other) => sum + cosine(vector, vectors[indexes[other]]), 0)
    const bonus = readableTitle(member.title) ? 0.2 : 0
    if (closeness + bonus > bestScore) {
      best = member
      bestScore = closeness + bonus
    }
  })
  return best
}

function pickQuestions(members: QaNote[], representative: QaNote): QaNote[] {
  const seen = new Set<string>()
  const picked: QaNote[] = []
  const ordered = [representative, ...[...members].sort((a, b) => b.createdAt.localeCompare(a.createdAt))]
  for (const note of ordered) {
    const key = normalizeQuestion(note.question)
    if (!key || seen.has(key)) continue
    seen.add(key)
    picked.push(note)
    if (picked.length >= 5) break
  }
  return picked.slice(0, 5)
}

function clusterTitle(note: QaNote): string {
  if (readableTitle(note.title)) return squash(note.title).slice(0, 42)
  const sentence = squash(note.question).split(/[。！？!?]/)[0] || note.question
  return sentence.slice(0, 42)
}

function readableTitle(title: string): boolean {
  const han = title.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  if (han < 4) return false
  const underscores = title.match(/_/g)?.length ?? 0
  if (underscores >= 2) return false
  if (/^\d{2,}/.test(title) && title.includes('_')) return false
  return true
}

function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[^\u4e00-\u9fffa-z0-9]/g, '')
}

function countGrams(text: string): Map<string, number> {
  const clean = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
  const counts = new Map<string, number>()
  for (let size = 2; size <= 3; size++) {
    for (let index = 0; index <= clean.length - size; index++) {
      const gram = clean.slice(index, index + size)
      if (STOP.has(gram)) continue
      counts.set(gram, (counts.get(gram) ?? 0) + (size === 3 ? 2 : 1))
    }
  }
  return counts
}

function weigh(counts: Map<string, number>, df: Map<string, number>, total: number): Map<string, number> {
  const vector = new Map<string, number>()
  let norm = 0
  for (const [gram, count] of counts) {
    const idf = Math.log((total + 1) / ((df.get(gram) ?? 0) + 1)) + 1
    const weight = (1 + Math.log(count)) * idf
    vector.set(gram, weight)
    norm += weight * weight
  }
  norm = Math.sqrt(norm) || 1
  for (const [gram, weight] of vector) vector.set(gram, weight / norm)
  return vector
}

function centroid(vectors: Array<Map<string, number>>): Map<string, number> {
  const sum = new Map<string, number>()
  for (const vector of vectors) {
    for (const [gram, weight] of vector) sum.set(gram, (sum.get(gram) ?? 0) + weight)
  }
  let norm = 0
  for (const weight of sum.values()) norm += weight * weight
  norm = Math.sqrt(norm) || 1
  for (const [gram, weight] of sum) sum.set(gram, weight / norm)
  return sum
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  for (const [gram, weight] of small) {
    const other = large.get(gram)
    if (other) dot += weight * other
  }
  return dot
}

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
