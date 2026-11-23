import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import sharp from 'sharp'
import { StudioDb } from './db.ts'
import { EMBED_DIM, EMBED_MODEL, blobToVector, cosine, embedText, vectorToBlob } from './embed.ts'
import { excludedPath, nowIso, uid } from './util.ts'

const TEXT_EXT = new Set(['.md', '.markdown', '.txt'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export interface AssetHit {
  assetId: string
  title: string
  sourcePath: string
  kind: string
  score: number
  rationale: string
  thumbPath: string | null
}

export class AssetLibrary {
  private watcher: FSWatcher | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly db: StudioDb,
    private readonly roots: string[],
    private readonly excludeGlobs: string[],
    private readonly thumbDir: string,
    private readonly ocrCommand: string,
  ) {}

  async start(watch: boolean) {
    mkdirSync(this.thumbDir, { recursive: true })
    await this.scanAll()
    if (!watch || this.roots.length === 0) return
    this.watcher = chokidar.watch(this.roots, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })
    const schedule = () => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => { void this.scanAll() }, 250)
    }
    this.watcher.on('add', schedule).on('change', schedule).on('unlink', schedule)
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer)
    await this.watcher?.close()
  }

  async scanAll() {
    const seen = new Set<string>()
    const liveRoots = new Set<string>()
    for (const root of this.roots) {
      let absRoot: string
      try {
        absRoot = resolve(root)
        statSync(absRoot)
      } catch {
        continue
      }
      liveRoots.add(absRoot)
      for (const file of walk(absRoot)) {
        const rel = relative(absRoot, file)
        if (excludedPath(rel, this.excludeGlobs)) continue
        const key = `${absRoot}${sep}${rel}`
        seen.add(key)
        await this.ingest(absRoot, rel, file)
      }
    }
    const rows = this.db.db.prepare(`SELECT id, root, rel_path FROM assets WHERE deleted_at IS NULL`).all() as Array<{ id: string, root: string, rel_path: string }>
    for (const row of rows) {
      if (!liveRoots.has(row.root)) continue
      if (!seen.has(`${row.root}${sep}${row.rel_path}`)) {
        this.db.db.prepare(`UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), row.id)
      }
    }
  }

  private async ingest(root: string, rel: string, abs: string) {
    const ext = extname(abs).toLowerCase()
    const kind = TEXT_EXT.has(ext) ? 'text' : IMAGE_EXT.has(ext) ? 'image' : ''
    if (!kind) return
    const info = statSync(abs)
    const existing = this.db.db.prepare(
      `SELECT id, sha256, mtime_ms FROM assets WHERE root = ? AND rel_path = ?`,
    ).get(root, rel) as { id: string, sha256: string, mtime_ms: number } | undefined
    if (existing && existing.mtime_ms === Math.round(info.mtimeMs) && !this.isDeleted(existing.id)) return
    const bytes = readFileSync(abs)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const duplicate = this.db.db.prepare(
      `SELECT id FROM assets WHERE sha256 = ? AND deleted_at IS NULL AND NOT (root = ? AND rel_path = ?)`,
    ).get(sha256, root, rel) as { id: string } | undefined
    if (duplicate) {
      if (existing) this.db.db.prepare(`UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), existing.id)
      return
    }
    const id = existing?.id ?? uid()
    const mime = kind === 'image'
      ? (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg')
      : 'text/plain'
    let title = rel.split(/[\\/]/).pop() ?? rel
    let text = ''
    let width: number | null = null
    let height: number | null = null
    let thumb: string | null = null
    let ocr = ''
    if (kind === 'text') {
      text = bytes.toString('utf8')
      const heading = text.match(/^#\s+(.+)$/m)
      if (heading) title = heading[1].trim()
    } else {
      const meta = await sharp(bytes).metadata()
      width = meta.width ?? null
      height = meta.height ?? null
      title = title.replace(ext, '')
      thumb = join(this.thumbDir, `${id}.webp`)
      await sharp(bytes).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 80 }).toFile(thumb)
      text = `${title} ${width ?? ''}x${height ?? ''}`
      if (this.ocrCommand) ocr = await runOcr(this.ocrCommand, abs)
      if (ocr) text = `${text}\n${ocr}`
    }
    const stamp = nowIso()
    this.db.tx(() => {
      if (existing) {
        this.db.db.prepare(`DELETE FROM asset_chunks WHERE asset_id = ?`).run(id)
        this.db.db.prepare(`DELETE FROM asset_tags WHERE asset_id = ?`).run(id)
        this.db.db.prepare(`DELETE FROM asset_embeddings WHERE asset_id = ?`).run(id)
        this.db.db.prepare(`
          UPDATE assets SET sha256=?, mime=?, kind=?, bytes=?, width=?, height=?, thumb_path=?, title=?,
            text_content=?, mtime_ms=?, ocr_text=?, updated_at=?, deleted_at=NULL, abs_path=?
          WHERE id=?
        `).run(sha256, mime, kind, bytes.length, width, height, thumb, title, text, Math.round(info.mtimeMs), ocr, stamp, abs, id)
      } else {
        this.db.db.prepare(`
          INSERT INTO assets(id, root, rel_path, abs_path, sha256, mime, kind, bytes, width, height, thumb_path, title, text_content, mtime_ms, ocr_text, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(id, root, rel, abs, sha256, mime, kind, bytes.length, width, height, thumb, title, text, Math.round(info.mtimeMs), ocr, stamp, stamp)
      }
      const chunks = chunkDocument(title, text)
      const insertChunk = this.db.db.prepare(`INSERT INTO asset_chunks(id, asset_id, ordinal, heading, text) VALUES (?, ?, ?, ?, ?)`)
      const insertEmb = this.db.db.prepare(`INSERT INTO asset_embeddings(id, asset_id, chunk_id, model, dim, vector) VALUES (?, ?, ?, ?, ?, ?)`)
      chunks.forEach((chunk, ordinal) => {
        const chunkId = uid()
        insertChunk.run(chunkId, id, ordinal, chunk.heading, chunk.text)
        insertEmb.run(uid(), id, chunkId, EMBED_MODEL, EMBED_DIM, vectorToBlob(embedText(`${chunk.heading}\n${chunk.text}`)))
      })
      const tags = new Set<string>()
      if (kind === 'image') tags.add('图片')
      if (kind === 'text') tags.add('笔记')
      if (/评|评论|差评/.test(text)) tags.add('评论')
      if (/产品|卖点/.test(text + title)) tags.add('产品')
      const insertTag = this.db.db.prepare(`INSERT INTO asset_tags(asset_id, tag) VALUES (?, ?)`)
      for (const tag of tags) insertTag.run(id, tag)
      this.db.indexText('asset', id, `${title}\n${text}`)
    })
  }

  private isDeleted(id: string) {
    const row = this.db.db.prepare(`SELECT deleted_at FROM assets WHERE id = ?`).get(id) as { deleted_at: string | null }
    return Boolean(row.deleted_at)
  }

  search(query: string, limit = 8): AssetHit[] {
    const lexical = new Map<string, number>()
    const terms = searchTerms(query)
    for (const term of terms) {
      for (const row of this.db.searchText(term, 30)) {
        if (row.entity_type !== 'asset') continue
        lexical.set(row.entity_id, (lexical.get(row.entity_id) ?? 0) + 1)
      }
    }
    const queryVector = embedText(query)
    const vectors = this.db.db.prepare(`
      SELECT e.asset_id, e.vector FROM asset_embeddings e
      JOIN assets a ON a.id = e.asset_id
      WHERE a.deleted_at IS NULL
    `).all() as Array<{ asset_id: string, vector: Uint8Array }>
    const semantic = new Map<string, number>()
    for (const row of vectors) {
      const score = cosine(queryVector, blobToVector(row.vector))
      semantic.set(row.asset_id, Math.max(semantic.get(row.asset_id) ?? 0, score))
    }
    const ids = new Set([...lexical.keys(), ...semantic.keys()])
    const hits: AssetHit[] = []
    for (const assetId of ids) {
      const asset = this.db.db.prepare(`SELECT id, title, abs_path, kind, thumb_path, text_content FROM assets WHERE id = ? AND deleted_at IS NULL`).get(assetId) as
        | { id: string, title: string, abs_path: string, kind: string, thumb_path: string | null, text_content: string }
        | undefined
      if (!asset) continue
      const keyword = Math.min(1, (lexical.get(assetId) ?? 0) / 3)
      const embed = semantic.get(assetId) ?? 0
      const imageBoost = asset.kind === 'image' && keyword > 0 ? 0.15 : 0
      const score = keyword * 0.65 + embed * 0.35 + imageBoost
      if (score < 0.08 && keyword === 0) continue
      hits.push({
        assetId,
        title: asset.title,
        sourcePath: asset.abs_path,
        kind: asset.kind,
        score,
        thumbPath: asset.thumb_path,
        rationale: keyword > 0
          ? `全文检索命中「${query.slice(0, 18)}」，并与本地向量相近（${embed.toFixed(2)}）。`
          : `向量相近（${embed.toFixed(2)}），来源文件可追溯。`,
      })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }

  get(id: string) {
    return this.db.db.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  }
}

function searchTerms(query: string): string[] {
  const grams = query.match(/[\u4e00-\u9fff]{2,4}/g) ?? []
  const unique = [...new Set(grams)]
  if (unique.length === 0 && query.trim()) return [query.trim().slice(0, 32)]
  return unique.slice(0, 16)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function chunkDocument(title: string, text: string): Array<{ heading: string, text: string }> {
  const parts = text.split(/\n(?=#+\s)/)
  const chunks = parts.map(part => {
    const heading = part.match(/^#+\s+(.+)$/m)?.[1]?.trim() ?? title
    return { heading, text: part.trim().slice(0, 2000) }
  }).filter(part => part.text.length > 0)
  return chunks.length > 0 ? chunks : [{ heading: title, text: title }]
}

function runOcr(command: string, file: string): Promise<string> {
  return new Promise(resolvePromise => {
    const child = spawn(command, [file], { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    const timer = setTimeout(() => child.kill(), 8000)
    child.stdout.on('data', (buf: Buffer) => chunks.push(buf))
    child.on('error', () => { clearTimeout(timer); resolvePromise('') })
    child.on('close', () => { clearTimeout(timer); resolvePromise(Buffer.concat(chunks).toString('utf8').trim()) })
  })
}

export function removeThumb(path: string | null) {
  if (!path) return
  try { unlinkSync(path) } catch { /* already gone */ }
}
