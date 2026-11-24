import { StudioDb } from '../db.ts'
import { nowIso, uid } from '../util.ts'
import { clusterQuestions, formatClusterBody, markPublished, selectBoard, type QaCluster, type QaNote } from './cluster.ts'
import { isQaMarkdown, parseQaMarkdown } from './parse.ts'

const RECOMMENDED = new Set([
  '为什么我愿意为「慢」付钱',
  '产品图拍完，评论区却在说另一件事',
  '把一次差评写成可复用的判断',
  '本地素材库里已经有答案',
  '小标题比金句更难写',
])

export interface SeedReport {
  notes: number
  clusters: number
  board: number
  pool: number
  removedLegacy: number
}

export function rebuildQaBoard(db: StudioDb, maxCards: number): SeedReport {
  const removedLegacy = cleanupLegacySeeds(db)
  const notes = collectQaNotes(db)
  if (notes.length === 0) return { notes: 0, clusters: 0, board: 0, pool: 0, removedLegacy }
  const clusters = clusterQuestions(notes)
  markPublished(clusters, publishedTexts(db))
  const picked = selectBoard(clusters, maxCards)
  const placed = [
    ...picked.board.map(cluster => ({ ...cluster, placement: 'board' as const })),
    ...picked.pool.map(cluster => ({ ...cluster, placement: 'pool' as const })),
  ]
  applyClusters(db, placed)
  return {
    notes: notes.length,
    clusters: clusters.length,
    board: picked.board.length,
    pool: picked.pool.length,
    removedLegacy,
  }
}

export function cleanupLegacySeeds(db: StudioDb): number {
  const titles = legacyTitles(db)
  const rows = db.db.prepare(`
    SELECT c.id AS card_id, c.topic_id, c.title
    FROM cards c
    JOIN topics t ON t.id = c.topic_id
    WHERE c.source = 'ai' AND t.source = 'ai'
      AND c.maturity = 'seed' AND c.input_version = 0
      AND c.status = 'open' AND c.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.card_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM ai_analyses a WHERE a.card_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.card_id = c.id)
  `).all() as Array<{ card_id: string, topic_id: string, title: string }>
  const doomed = rows.filter(row => titles.has(row.title) && !RECOMMENDED.has(row.title))
  if (doomed.length === 0) return 0
  db.tx(() => {
    for (const row of doomed) deleteCard(db, row.card_id, row.topic_id)
  })
  return doomed.length
}

function legacyTitles(db: StudioDb): Set<string> {
  const rows = db.db.prepare(`
    SELECT title, rel_path FROM assets
    WHERE rel_path LIKE '%Xhs_QA%' OR rel_path LIKE '%小红书问答%'
  `).all() as Array<{ title: string, rel_path: string }>
  const titles = new Set<string>()
  for (const row of rows) {
    if (row.title.trim()) titles.add(row.title.trim())
    const base = row.rel_path.split(/[\\/]/).pop() ?? ''
    const stem = base.replace(/\.(md|markdown|txt|png|jpe?g|webp|gif|xlsx|csv|db|json)$/i, '')
    if (stem) titles.add(stem)
  }
  return titles
}

function collectQaNotes(db: StudioDb): QaNote[] {
  const rows = db.db.prepare(`
    SELECT id, rel_path, text_content FROM assets
    WHERE deleted_at IS NULL AND kind = 'text'
      AND (rel_path LIKE '%Xhs_QA%' OR rel_path LIKE '%小红书问答%')
  `).all() as Array<{ id: string, rel_path: string, text_content: string }>
  const images = db.db.prepare(`
    SELECT id, rel_path, title FROM assets
    WHERE deleted_at IS NULL AND kind = 'image'
      AND (rel_path LIKE '%Xhs_QA%' OR rel_path LIKE '%小红书问答%')
  `).all() as Array<{ id: string, rel_path: string, title: string }>
  const byName = new Map<string, { id: string, rel_path: string }>()
  for (const image of images) {
    const name = basename(image.rel_path).toLowerCase()
    const previous = byName.get(name)
    if (!previous || (!previous.rel_path.includes('/images/') && image.rel_path.includes('/images/'))) {
      byName.set(name, image)
    }
  }
  const notes: QaNote[] = []
  for (const row of rows) {
    if (!isQaMarkdown(row.rel_path)) continue
    const parsed = parseQaMarkdown(row.text_content)
    if (!parsed) continue
    const source = byName.get(parsed.sourceFile.toLowerCase())
    notes.push({
      ...parsed,
      id: row.id,
      assetId: row.id,
      relPath: row.rel_path,
      sourceAssetId: source?.id ?? null,
    })
  }
  return notes
}

function publishedTexts(db: StudioDb): string[] {
  const rows = db.db.prepare(`
    SELECT title, text_content, rel_path FROM assets WHERE deleted_at IS NULL
  `).all() as Array<{ title: string, text_content: string, rel_path: string }>
  return rows.filter(row => isPublishedPath(row.rel_path)).flatMap(row => [row.title, firstHeading(row.text_content)])
}

function applyClusters(db: StudioDb, clusters: Array<QaCluster & { placement: 'board' | 'pool' }>) {
  const stamp = nowIso()
  const existing = db.db.prepare(`SELECT id, cluster_key, title, source FROM topics`).all() as Array<{ id: string, cluster_key: string, title: string, source: string }>
  const byKey = new Map(existing.filter(topic => topic.cluster_key).map(topic => [topic.cluster_key, topic]))
  const used = new Set<string>()
  db.tx(() => {
    db.db.prepare(`DELETE FROM qa_items`).run()
    for (const cluster of clusters) {
      const summary = formatClusterBody(cluster)
      let topic = byKey.get(cluster.key)
      if (topic && used.has(topic.id)) topic = undefined
      if (!topic) {
        topic = existing.find(item => !used.has(item.id) && item.title === cluster.title && (item.source === 'qa' || item.source === 'ai'))
      }
      const cards = topic
        ? db.db.prepare(`SELECT id, title, source, maturity, input_version, status, deleted_at FROM cards WHERE topic_id = ?`).all(topic.id) as CardTouch[]
        : []
      const card = cards.find(item => !item.deleted_at)
      const dismissed = cards.some(item => item.deleted_at)
      const touched = card ? !isUntouched(db, card) : false
      const title = touched && card ? String(card.title) : cluster.title
      let topicId = topic?.id
      if (!topicId) {
        topicId = uid()
        db.db.prepare(`
          INSERT INTO topics(id, title, summary, source, created_at, updated_at, placement, ask_count, cluster_key)
          VALUES (?, ?, ?, 'qa', ?, ?, ?, ?, ?)
        `).run(topicId, title, summary, stamp, stamp, cluster.placement, cluster.members.length, cluster.key)
      } else {
        db.db.prepare(`
          UPDATE topics
          SET title = ?, summary = ?, source = 'qa', placement = ?, ask_count = ?, cluster_key = ?, updated_at = ?
          WHERE id = ?
        `).run(title, summary, cluster.placement, cluster.members.length, cluster.key, stamp, topicId)
      }
      used.add(topicId)
      db.indexText('topic', topicId, `${title}\n${summary}\n${cluster.members.map(note => note.question).join('\n')}`)
      const insertItem = db.db.prepare(`
        INSERT INTO qa_items(id, asset_id, source_asset_id, title, question, answer, created_at_src, source_file, rel_path, cluster_key, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const note of cluster.members) {
        insertItem.run(uid(), note.assetId, note.sourceAssetId, note.title, note.question, note.answer, note.createdAt, note.sourceFile, note.relPath, cluster.key, stamp)
      }
      syncCard(db, topicId, title, cluster.placement, card, dismissed, stamp)
    }
    retireUnused(db, used)
  })
}

interface CardTouch {
  id: string
  title: string
  source: string
  maturity: string
  input_version: number
  status: string
  deleted_at: string | null
}

function syncCard(db: StudioDb, topicId: string, title: string, placement: 'board' | 'pool', card: CardTouch | undefined, dismissed: boolean, stamp: string) {
  if (placement === 'board') {
    if (!card) {
      if (dismissed) return
      const cardId = uid()
      db.db.prepare(`
        INSERT INTO cards(id, topic_id, title, status, maturity, input_version, source, created_at, updated_at)
        VALUES (?, ?, ?, 'open', 'seed', 0, 'ai', ?, ?)
      `).run(cardId, topicId, title, stamp, stamp)
      db.indexText('card', cardId, title)
      return
    }
    if (isUntouched(db, card) && card.title !== title) {
      db.db.prepare(`UPDATE cards SET title = ?, updated_at = ? WHERE id = ?`).run(title, stamp, card.id)
      db.indexText('card', card.id, title)
    }
    return
  }
  if (card && isUntouched(db, card)) deleteCard(db, card.id, topicId, true)
}

function retireUnused(db: StudioDb, used: Set<string>) {
  const rows = db.db.prepare(`SELECT id FROM topics WHERE source = 'qa'`).all() as Array<{ id: string }>
  for (const row of rows) {
    if (used.has(row.id)) continue
    const cards = db.db.prepare(`SELECT id, title, source, maturity, input_version, status, deleted_at FROM cards WHERE topic_id = ? AND deleted_at IS NULL`).all(row.id) as CardTouch[]
    for (const card of cards) {
      if (isUntouched(db, card)) deleteCard(db, card.id, row.id)
    }
    const left = db.db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE topic_id = ? AND deleted_at IS NULL`).get(row.id) as { n: number }
    if (left.n === 0) {
      db.db.prepare(`DELETE FROM content_fts WHERE entity_id = ? AND entity_type = 'topic'`).run(row.id)
      db.db.prepare(`DELETE FROM topics WHERE id = ?`).run(row.id)
    }
  }
}

function isUntouched(db: StudioDb, card: CardTouch): boolean {
  if (card.deleted_at) return false
  if (card.source !== 'ai' && card.source !== 'qa') return false
  if (card.maturity !== 'seed' || Number(card.input_version) !== 0 || card.status !== 'open') return false
  const hit = db.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM interactions WHERE card_id = ?) +
      (SELECT COUNT(*) FROM ai_analyses WHERE card_id = ?) +
      (SELECT COUNT(*) FROM projects WHERE card_id = ?) AS n
  `).get(card.id, card.id, card.id) as { n: number }
  return hit.n === 0
}

function deleteCard(db: StudioDb, cardId: string, topicId: string, keepTopic = false) {
  db.db.prepare(`DELETE FROM jobs WHERE card_id = ?`).run(cardId)
  db.db.prepare(`DELETE FROM content_fts WHERE entity_id = ? AND entity_type = 'card'`).run(cardId)
  db.db.prepare(`DELETE FROM cards WHERE id = ?`).run(cardId)
  const left = db.db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE topic_id = ?`).get(topicId) as { n: number }
  if (!keepTopic && left.n === 0) {
    db.db.prepare(`DELETE FROM content_fts WHERE entity_id = ? AND entity_type = 'topic'`).run(topicId)
    db.db.prepare(`DELETE FROM topics WHERE id = ?`).run(topicId)
  }
}

function isPublishedPath(relPath: string): boolean {
  const clean = relPath.replace(/\\/g, '/')
  return clean.includes('Archive_归档') || clean.includes('Deliverables_发布定稿') || clean.includes('/Archive/') || clean.includes('/Deliverables/')
}

function firstHeading(text: string): string {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ''
}

function basename(relPath: string): string {
  return relPath.replace(/\\/g, '/').split('/').pop() ?? ''
}
