import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import sharp from 'sharp'
import { StudioDb } from '../src/db.ts'
import { apply, Config } from '../src/index.ts'
import { PAGE_H, PAGE_W } from '../src/render.ts'
import { StudioRuntime } from '../src/runtime.ts'
import type { StudioConfig } from '../src/config.ts'

const dirs: string[] = []
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'pms-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function config(dir: string, library: string, engine: StudioConfig['render']['engine'] = 'sharp'): StudioConfig {
  return {
    dataDir: join(dir, 'data'),
    libraryRoots: [library],
    libraryProfile: 'generic',
    knowledgeDir: '',
    excludeGlobs: ['**/.git/**', '**/node_modules/**'],
    exportDir: join(dir, 'exports'),
    watch: false,
    llm: { provider: '', model: '' },
    privacy: { sendImagesToCloud: false },
    ocr: { command: '' },
    brand: { author: '一个路人甲', role: '自学面试上岸' },
    render: { engine, size: 'standard', xhsRenderPy: '' },
    topicSeed: { maxCards: 12 },
  }
}

function seed(library: string) {
  execFileSync(process.execPath, ['scripts/seed-library.mjs', library], { cwd: process.cwd(), stdio: 'pipe' })
}

async function openStudio(dir: string, library: string, engine?: StudioConfig['render']['engine']) {
  const ctx = { llm: { listProviders: () => [], stream: async function* () {} } } as unknown as Context
  return StudioRuntime.open(ctx, config(dir, library, engine))
}

describe('database', () => {
  it('migrates the business tables and searches Chinese with FTS5', () => {
    const db = new StudioDb(join(temp(), 'studio.sqlite'))
    const names = (db.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(row => row.name)
    for (const table of ['assets', 'asset_chunks', 'asset_tags', 'asset_embeddings', 'topics', 'cards', 'interactions', 'ai_analyses', 'ai_suggestions', 'jobs', 'projects', 'drafts', 'draft_pages', 'asset_relations', 'style_profiles', 'versions', 'exports', 'inspiration_sources', 'inspiration_items', 'inspiration_candidates']) {
      expect(names).toContain(table)
    }
    expect((db.db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get() as { n: number }).n).toBe(7)
    expect((db.db.prepare(`SELECT COUNT(*) AS n FROM style_profiles`).get() as { n: number }).n).toBe(3)
    db.indexText('asset', 'a1', '个人媒体工作室的选题卡片与金句提取')
    const hit = db.searchText('金句提')
    expect(hit.some(row => row.entity_id === 'a1')).toBe(true)
    const backup = join(temp(), 'backup.sqlite')
    db.backup(backup)
    expect(statSync(backup).size).toBeGreaterThan(1000)
    db.close()
  })
})

describe('inspiration inbox', () => {
  it('captures an author note and only creates a topic after approval', async () => {
    const dir = temp()
    const studio = await openStudio(dir, join(dir, 'library'))
    const before = studio.listCards().length
    const captured = studio.captureInspiration('面试时脑子空白，不是没背，是没练过“开口”。', 'https://example.com/note')
    expect(captured.counts.pending).toBe(1)
    expect(captured.candidates).toHaveLength(1)
    const candidate = captured.candidates[0]
    expect(candidate.sourceName).toBe('手动收件箱')
    expect(candidate.cardId).toBeNull()
    expect(studio.listCards()).toHaveLength(before)

    const approved = studio.decideInspiration(candidate.id, 'approved')
    expect(approved.counts.approved).toBe(1)
    expect(approved.cardId).toBeTruthy()
    expect(studio.listCards()).toHaveLength(before + 1)
    expect(studio.getCard(approved.cardId as string).card.title).toContain('面试时脑子空白')

    const rejected = studio.captureInspiration('这条不想要。')
    const noCard = studio.decideInspiration(rejected.candidates[0].id, 'rejected')
    expect(noCard.counts.rejected).toBe(1)
    expect(noCard.cardId).toBeNull()
    await studio.dispose()
  })

  it('lets a material-library asset enter the inbox without copying or approving it', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    seed(library)
    const studio = await openStudio(dir, library)
    const hits = studio.searchInspirationAssets('澄白')
    expect(hits.length).toBeGreaterThan(0)
    const before = studio.listCards().length
    const captured = studio.captureLibraryInspiration(hits[0].assetId)
    const candidate = captured.candidates.find(item => item.sourceName === '素材库')
    expect(candidate?.status).toBe('pending')
    expect(candidate?.itemProvenance).toContain('素材库 ·')
    expect(captured.sources.find(source => source.id === 'library')?.status).toBe('connected')
    expect(studio.listCards()).toHaveLength(before)
    await studio.dispose()
  })

  it('imports Qianfan note metrics as evidence without creating cards', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    seed(library)
    const csv = join(library, 'qianfan-notes.csv')
    writeFileSync(csv, [
      '笔记标题,首次发布时间,观看量,点赞,收藏,评论,分享,涨粉,曝光,封面点击率,人均观看时长,商品点击,营收',
      '面试开口卡壳,2026-10-01,1983,105,111,6,10,12,12000,10.9%,30.25,206,128.12',
      '背了金句不会用,2026-10-02,624,26,13,2,1,3,5821,10.7%,18,0,0',
    ].join('\n'), 'utf8')
    const studio = await openStudio(dir, library)
    const before = studio.listCards().length
    const first = studio.importQianfanNotes(csv)
    expect(first.imported).toBe(2)
    expect(first.skipped).toBe(0)
    const view = studio.listInspiration()
    expect(view.sources.find(source => source.id === 'qianfan-notes')?.status).toBe('connected')
    const imported = view.items.filter(item => item.sourceId === 'qianfan-notes')
    expect(imported).toHaveLength(2)
    expect(imported[0].metaJson).toContain('"attribution":"note"')
    expect(view.counts.pending).toBe(2)
    const noteCandidates = view.candidates.filter(candidate => candidate.sourceId === 'qianfan-notes')
    expect(noteCandidates[0].angle).toBe('面试开口卡壳')
    expect(noteCandidates[0].signal).toBe('收藏率 5.6%')
    expect(noteCandidates[0].status).toBe('pending')
    expect(noteCandidates[0].why).toContain('收藏率')
    expect(studio.listCards()).toHaveLength(before)
    const second = studio.importQianfanNotes(csv)
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(2)
    expect(studio.listInspiration().counts.pending).toBe(2)
    await studio.dispose()
  })

  it('imports Qianfan orders as product-level evidence without creating cards', async () => {
    const dir = temp()
    const studio = await openStudio(dir, join(dir, 'library'))
    const csv = [
      '订单号,商品名称,实付金额,退款金额,订单状态,成交时间,笔记标题',
      'A1,澄白Mini,128.12,0,已完成,2026-10-01 10:00,面试开口卡壳',
      'A2,澄白Mini,99.00,20,部分退款,2026-10-02 11:00,面试开口卡壳',
      'A3,手冲壶,58.00,0,已完成,2026-10-03 12:00,背了金句不会用',
    ].join('\n')
    const before = studio.listCards().length
    const first = studio.importQianfanOrdersText(csv, 'qianfan-orders.csv')
    expect(first.imported).toBe(3)
    expect(first.candidates).toBe(2)
    const view = studio.listInspiration()
    expect(view.sources.find(source => source.id === 'qianfan-orders')?.status).toBe('connected')
    const product = view.candidates.find(candidate => candidate.angle.includes('澄白Mini'))
    expect(product?.status).toBe('pending')
    expect(product?.why).toContain('本批成交 2 笔')
    expect(product?.why).toContain('退款 1 笔')
    expect(studio.listCards()).toHaveLength(before)
    const second = studio.importQianfanOrdersText(csv, 'qianfan-orders.csv')
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(3)
    expect(studio.listInspiration().counts.pending).toBe(2)
    await studio.dispose()
  })

  it('lets the assistant propose without approving or creating a card', async () => {
    const dir = temp()
    const studio = await openStudio(dir, join(dir, 'library'))
    const before = studio.listCards().length
    studio.captureInspiration('面试开口卡壳，不是没背，是没练过开口。')
    const proposed = studio.captureInspiration(
      '高收藏笔记里反复出现的一句话：先练开口，再背答案。',
      'https://example.com/high-save',
      'agent',
      '这条笔记收藏 111，评论里多人提到“开口就空白”。',
    )
    const candidate = proposed.candidates.find(item => item.sourceName === '助手提议')
    expect(candidate?.status).toBe('pending')
    expect(candidate?.why).toContain('开口就空白')
    expect(proposed.counts.approved).toBe(0)
    expect(studio.listCards()).toHaveLength(before)

    const found = studio.searchInspiration('开口')
    expect(found.candidates.length).toBeGreaterThanOrEqual(2)
    expect(found.candidates.every(item => item.angle.includes('开口') || item.why.includes('开口') || item.itemBody.includes('开口'))).toBe(true)
    await studio.dispose()
  })
})

describe('settings', () => {
  it('persists safe AI and brand settings without storing a key', async () => {
    const dir = temp()
    const studio = await openStudio(dir, join(dir, 'library'))
    expect(studio.settingsView().ai.configured).toBe(false)
    const saved = await studio.saveSettings({ ai: { provider: '', model: '' }, brand: { author: '测试作者', role: '写作者' } })
    expect(saved.brand.author).toBe('测试作者')
    const file = join(dir, 'data', 'settings.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { ai: { provider: string }, brand: { author: string } }
    expect(raw.ai.provider).toBe('')
    expect(raw.brand.author).toBe('测试作者')
    expect(JSON.stringify(raw)).not.toContain('apiKey')
    await studio.dispose()

    const reopened = await openStudio(dir, join(dir, 'library'))
    expect(reopened.settingsView().brand.author).toBe('测试作者')
    await reopened.dispose()
  })

  it('reads a settings file written with a UTF-8 BOM', async () => {
    const dir = temp()
    const library = join(dir, 'manual-library')
    seed(library)
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'settings.json'), `\uFEFF${JSON.stringify({
      ai: { provider: '', model: '' },
      brand: { author: 'BOM 作者', role: '写作者' },
      libraryRoot: library,
    })}`, 'utf8')
    const studio = await openStudio(dir, join(dir, 'empty-library'))
    const view = studio.settingsView()
    expect(view.brand.author).toBe('BOM 作者')
    expect(view.workspace.libraryRoots[0]).toContain('manual-library')
    expect(view.workspace.libraryCount).toBeGreaterThan(0)
    await studio.dispose()
  })

  it('rejects an unknown provider instead of silently falling back', async () => {
    const dir = temp()
    const studio = await openStudio(dir, join(dir, 'library'))
    await expect(studio.saveSettings({ ai: { provider: 'not-registered', model: 'x' } })).rejects.toThrow(/provider/)
    await studio.dispose()
  })

  it('persists and reindexes a manually chosen library root', async () => {
    const dir = temp()
    const library = join(dir, 'manual-library')
    seed(library)
    const studio = await openStudio(dir, join(dir, 'empty'))
    const saved = await studio.saveSettings({ ai: { provider: '', model: '' }, brand: { author: '一个路人甲', role: '自学面试上岸' }, libraryRoot: library })
    expect(saved.workspace.libraryRoots[0]).toContain('manual-library')
    expect(saved.workspace.libraryCount).toBeGreaterThan(0)
    expect(studio.listInspiration().sources.find(source => source.id === 'library')?.status).toBe('connected')
    await studio.dispose()

    const reopened = await openStudio(dir, join(dir, 'empty'))
    expect(reopened.settingsView().workspace.libraryRoots[0]).toContain('manual-library')
    expect(reopened.settingsView().workspace.libraryCount).toBeGreaterThan(0)
    await reopened.dispose()
  })
})

describe('atomic focus advance', () => {
  it('advances in one transaction and ignores a retried client op', async () => {
    const dir = temp()
    const studio = await openStudio(dir, join(dir, 'library'))
    const id = studio.createCard('聚焦推进的原子性').card.id as string
    const op = 'focus-op-1'
    const first = studio.advanceCard(id, '第一句判断', [], 'shelve', op)
    expect(first.interactions).toHaveLength(1)
    expect(first.card.status).toBe('shelved')
    const retry = studio.advanceCard(id, '第一句判断', [], 'shelve', op)
    expect(retry.interactions).toHaveLength(1)
    expect(studio.listBoardIds()).toContain(id)
    const matured = studio.advanceCard(id, '第二句判断', [], 'mature', 'focus-op-2')
    expect(matured.interactions).toHaveLength(2)
    expect(matured.card.maturity).toBe('mature')
    expect(studio.listBoardIds()).not.toContain(id)
    await studio.dispose()
  })
})

describe('library and cards', () => {
  it('scans, dedups by sha256, and keeps thoughts append-only', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    seed(library)
    const { copyFileSync } = await import('node:fs')
    copyFileSync(join(library, 'notes', '澄白便携咖啡机-卖点.md'), join(library, 'notes', '卖点-副本.md'))
    const studio = await openStudio(dir, library)
    const count = studio.db.db.prepare(`SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL`).get() as { n: number }
    expect(count.n).toBe(7)
    const hashes = studio.db.db.prepare(`SELECT sha256, COUNT(*) AS n FROM assets WHERE deleted_at IS NULL GROUP BY sha256 HAVING n > 1`).all()
    expect(hashes).toEqual([])
    const cards = studio.listCards()
    expect(cards.length).toBeGreaterThanOrEqual(5)
    const created = studio.createCard('我的慢咖啡')
    const id = created.card.id as string
    studio.appendThought(id, '我认为慢是这台澄白咖啡机真正的句子。例如评论区有人说出水太慢。但是赶时间的人会把慢当成失败。')
    studio.appendThought(id, '再补一句：酒店窗边的 40 秒。')
    const detail = studio.getCard(id)
    expect(detail.interactions).toHaveLength(2)
    expect(detail.interactions[0].body).toContain('我认为慢')
    expect(detail.interactions[1].body).toContain('40 秒')
    const edited = studio.editThought(id, detail.interactions[0].id, '我认为慢不是缺点，是这台澄白咖啡机真正的句子。')
    expect(edited.interactions[0].body).toBe('我认为慢不是缺点，是这台澄白咖啡机真正的句子。')
    expect(edited.card.input_version).toBe(3)
    await studio.drain()
    const analyzed = studio.getCard(id)
    expect((analyzed.analysis as { thesis?: string } | null)?.thesis).toBeTruthy()
    expect(analyzed.suggestions.filter(item => item.kind === 'question').length).toBeGreaterThan(0)
    const asked = analyzed.suggestions.map(item => item.text)
    studio.appendThought(id, '补充一个相反的人：她把这 40 秒当成暂停。')
    await studio.drain()
    const again = studio.getCard(id)
    const fresh = again.suggestions.filter(item => !asked.includes(item.text))
    expect(again.suggestions.every(item => asked.includes(item.text) || fresh.includes(item))).toBe(true)
    expect(new Set(again.suggestions.map(item => item.fingerprint)).size).toBe(again.suggestions.length)
    studio.deleteCard(id)
    const ids = () => studio.listCards().map(card => String((card as { id?: string }).id))
    expect(ids()).not.toContain(id)
    studio.restoreCard(id)
    expect(ids()).toContain(id)
    const found = studio.searchAssets('差评')
    expect(found.some(hit => hit.sourcePath.endsWith('一次差评的原话.md'))).toBe(true)
    await studio.dispose()
  })
})

describe('draft merging', () => {
  it('reports new thoughts instead of silently rewriting a draft', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    seed(library)
    const studio = await openStudio(dir, library)
    const id = studio.createCard('后记不能丢').card.id as string
    studio.appendThought(id, '第一段原话，先把它写成稿。')
    const first = studio.openArticle(id)
    expect(first.newThoughtCount).toBe(0)
    studio.appendThought(id, '第二段原话，是生成之后才记的。')
    const second = studio.openArticle(id)
    expect(second.newThoughtCount).toBe(1)
    expect(second.markdown).not.toContain('第二段原话')
    const merged = studio.appendArticleThoughts(id)
    expect(merged.markdown).toContain('第二段原话')
    expect(merged.newThoughtCount).toBe(0)
    await studio.drain()
    const version = Number(studio.getCard(id).card.input_version)
    studio.returnToTopics(id)
    const queued = studio.db.db.prepare(`SELECT id FROM jobs WHERE card_id = ? AND type = 'analyze' AND input_version = ? AND status IN ('queued','running')`).get(id, version)
    expect(queued).toBeTruthy()
    await studio.dispose()
  })
})

describe('jobs', () => {
  it('skips stale input versions and recovers a running job', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    seed(library)
    const studio = await openStudio(dir, library)
    const id = studio.createCard('版本守卫').card.id as string
    studio.appendThought(id, '第一句还很短。')
    const queued = studio.db.db.prepare(`SELECT id, input_version FROM jobs WHERE card_id = ? AND status = 'queued'`).get(id) as { id: string, input_version: number }
    studio.db.db.prepare(`UPDATE cards SET input_version = input_version + 1 WHERE id = ?`).run(id)
    await studio.drain()
    const skipped = studio.db.db.prepare(`SELECT status, error FROM jobs WHERE id = ?`).get(queued.id) as { status: string, error: string }
    expect(skipped.status).toBe('skipped')
    expect(skipped.error).toContain('stale')
    studio.db.db.prepare(`UPDATE jobs SET status = 'running', locked_at = ? WHERE card_id = ?`).run(new Date().toISOString(), id)
    await studio.dispose()
    const reopened = await openStudio(dir, library)
    const recovered = reopened.db.db.prepare(`SELECT status FROM jobs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(id) as { status: string }
    expect(recovered.status).not.toBe('running')
    await reopened.dispose()
  })
})

describe('production and export', () => {
  it('refuses promotion without a user intent, then exports traced 1242x1660 pages', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    seed(library)
    const studio = await openStudio(dir, library)
    const id = studio.createCard('差评与慢').card.id as string
    studio.appendThought(id, '我认为澄白咖啡机的慢值得被写成判断。例如评论区差评说出水太慢。但是把 40 秒留下来的人，会把它当成早晨的暂停。')
    await studio.drain()
    expect(() => studio.promote(id, 'forged-by-model')).toThrow(/明确确认/)
    expect((studio.getCard(id).card.status)).not.toBe('ready_for_production')
    const intent = studio.issueIntent(id, 'promote')
    studio.promote(id, intent)
    expect(studio.getCard(id).card.status).toBe('ready_for_production')
    const produced = await studio.startProduction(id, studio.issueIntent(id, 'produce'))
    expect(produced?.pages.length).toBeGreaterThanOrEqual(2)
    expect(produced?.pages.length).not.toBe(6)
    const cover = produced!.pages.find(page => page.role === 'cover')!
    const lead = cover.blocks.find(block => block.type === 'paragraph')?.spans?.map(span => span.text).join('')
    const quote = cover.blocks.find(block => block.type === 'quote')?.text
    expect(cover.title).not.toBe(lead)
    expect(quote).not.toBe(cover.title)
    expect(quote).not.toBe(lead)
    expect(produced!.pages.every(page => !page.title.includes('…'))).toBe(true)
    expect(JSON.stringify(produced!.pages)).toContain('"text":"出水太慢"')
    expect(produced?.relations.length).toBeGreaterThan(0)
    const relation = produced!.relations[0] as { id: string, source_path: string, asset_id: string }
    expect(relation.source_path.startsWith(library)).toBe(true)
    studio.decideAsset(relation.id, 'accepted', undefined, { x: 30, y: 40, scale: 1.1 })
    const saved = studio.decideAsset(relation.id, 'accepted')
    expect(saved.relationId).toBe(relation.id)
    const exported = await studio.exportProject(id)
    const manifest = JSON.parse(readFileSync(join(exported.dir, 'manifest.json'), 'utf8')) as { knowledge: string, files: string[] }
    expect(manifest.files.some(file => file.endsWith('.png'))).toBe(true)
    const png = readFileSync(join(exported.dir, manifest.files.find((file: string) => file.endsWith('.png'))!))
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(PAGE_W)
    expect(meta.height).toBe(PAGE_H)
    expect(readFileSync(join(exported.dir, 'body.md'), 'utf8')).toContain('澄白')
    const traced = JSON.parse(readFileSync(join(exported.dir, 'assets.json'), 'utf8')) as { assets: Array<{ sourcePath: string }> }
    expect(traced.assets.some(asset => asset.sourcePath === relation.source_path)).toBe(true)
    expect(readFileSync(manifest.knowledge, 'utf8')).toContain('回写')
    await studio.dispose()
  })
})

describe('card inspiration', () => {
  it('returns the untruncated question and answer for the collapsed/expanded source view', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    const qaDir = join(library, 'Xhs_QA_小红书问答')
    mkdirSync(qaDir, { recursive: true })
    const answer = '第一段：先承认手会抖，这是身体在准备，不是能力不够。\n\n第二段：把注意力放回问题本身，不要盯着自己的心跳。'.repeat(6)
    writeFileSync(join(qaDir, '面试紧张.md'), `# 面试紧张怎么办\n\n## 原始问题\n\n面试时手会抖，说话也快，怎么让自己稳下来？\n\n## 回答\n\n${answer}\n`)
    const ctx = { llm: { listProviders: () => [], stream: async function* () {} } } as unknown as Context
    const studio = await StudioRuntime.open(ctx, { ...config(dir, library), libraryProfile: 'lurenjia' })
    const cards = studio.listCards() as unknown as Array<{ id: string, title: string }>
    const card = cards.find(item => item.title.includes('面试紧张'))
    expect(card).toBeTruthy()
    const detail = studio.getCard(String(card!.id))
    const inspiration = detail.inspiration as { questions: string[], answer: string, images: unknown[], askCount: number } | null
    expect(inspiration).not.toBeNull()
    expect(inspiration!.questions[0]).toBe('面试时手会抖，说话也快，怎么让自己稳下来？')
    expect(inspiration!.answer).toContain('第一段：先承认手会抖')
    expect(inspiration!.answer).toContain('第二段：把注意力放回问题本身')
    expect(inspiration!.answer.length).toBeGreaterThan(280)
    expect(inspiration!.askCount).toBe(1)
    expect(inspiration!.images).toEqual([])
    // 看板摘要仍保留旧结构，客户端不再直接展示它。
    expect(detail.topicSummary).toContain('有 1 位同学问过')
    await studio.dispose()
  })
})

describe('read-only library and QA topics', () => {
  it('writes knowledge outside library roots and creates Xhs_QA topics when the scan finishes', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    mkdirSync(join(library, 'Xhs_QA_小红书问答'), { recursive: true })
    writeFileSync(join(library, 'Xhs_QA_小红书问答', '背模板.md'), '# 结构化面试是不是背模板\n\n同学问是不是背下来就行。')
    const ctx = { llm: { listProviders: () => [], stream: async function* () {} } } as unknown as Context
    const studio = await StudioRuntime.open(ctx, { ...config(dir, library), libraryProfile: 'lurenjia' })
    const topics = () => (studio.db.db.prepare('SELECT COUNT(*) AS n FROM topics').get() as { n: number }).n
    expect(topics()).toBeGreaterThan(0)
    expect(studio.listCards().some(card => String((card as { title?: string }).title).includes('背模板'))).toBe(true)
    const before = topics()
    await studio.assets.scanAll()
    expect(topics()).toBe(before)
    const note = studio.writeKnowledge('定稿回写', '原文保持不动。', join(dir, 'export'))
    expect(note.startsWith(join(dir, 'data', 'knowledge'))).toBe(true)
    expect(note.startsWith(library)).toBe(false)
    await studio.assets.scanAll()
    const found = studio.searchAssets('定稿回写')
    expect(found.some(hit => hit.sourcePath === note)).toBe(true)

    const inside = join(library, '我指定的回写')
    const explicit = await StudioRuntime.open(ctx, {
      ...config(join(dir, 'explicit'), library),
      libraryProfile: 'lurenjia',
      knowledgeDir: inside,
    })
    const placed = explicit.writeKnowledge('指定回写', '用户明确要求写在这里。', join(dir, 'export'))
    expect(placed.startsWith(inside)).toBe(true)

    const nested = await StudioRuntime.open(ctx, {
      ...config(join(dir, 'nested'), library),
      dataDir: join(library, 'plugin-data'),
      libraryProfile: 'lurenjia',
      knowledgeDir: '',
    })
    const outside = nested.writeKnowledge('不能进库', '正文', join(dir, 'export'))
    expect(outside.startsWith(library)).toBe(false)
    await studio.dispose()
    await explicit.dispose()
    await nested.dispose()
  })
})

describe('cordis plugin', () => {
  it('loads tools and fetch routes, then drops them on dispose and restart', async () => {
    class FakeTools extends Service {
      defs = new Map<string, { name: string, execute: (args: Record<string, string>) => Promise<unknown> }>()
      constructor(ctx: Context) { super(ctx, 'tools') }
      register(definition: { name: string, execute: (args: Record<string, string>) => Promise<unknown> }) {
        this.defs.set(definition.name, definition)
        const name = definition.name
        return this.ctx.effect(() => () => { this.defs.delete(name) })
      }
    }
    class FakeLlm extends Service {
      constructor(ctx: Context) { super(ctx, 'llm') }
      listProviders() { return [] as Array<{ id: string, name: string }> }
      async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } }
    }
    class FakeConnection extends Service {
      routes: unknown[] = []
      constructor(ctx: Context) { super(ctx, 'connection') }
      get fetch() {
        const owner = this.ctx
        return {
          register: (route: unknown) => {
            this.routes.push(route)
            return owner.effect(() => () => {
              const index = this.routes.indexOf(route)
              if (index >= 0) this.routes.splice(index, 1)
            })
          },
        }
      }
    }
    const dir = temp()
    const library = join(dir, 'library')
    seed(library)
    const ctx = new Context()
    await ctx.plugin(FakeTools)
    await ctx.plugin(FakeLlm)
    await ctx.plugin(FakeConnection)
    const fiber = await ctx.plugin({
      name: 'personal-media-studio',
      inject: ['tools', 'llm', 'connection'],
      Config,
      apply,
    }, config(dir, library))
    const toolService = ctx.tools as unknown as FakeTools
    expect(toolService.defs.has('media_promote_card')).toBe(true)
    expect(toolService.defs.has('media_list_cards')).toBe(true)
    expect(toolService.defs.has('media_list_inspiration')).toBe(true)
    expect(toolService.defs.has('media_search_inspiration')).toBe(true)
    expect(toolService.defs.has('media_propose_inspiration')).toBe(true)
    expect(toolService.defs.has('media_import_qianfan_notes')).toBe(true)
    const propose = toolService.defs.get('media_propose_inspiration')!
    const proposed = JSON.parse(String(await propose.execute({ body: '先把开口练熟，再背答案。', why: '口述角度' }))) as { ok: boolean, inspiration: { candidates: Array<{ id: string, sourceName: string, status: string }> } }
    expect(proposed.ok).toBe(true)
    expect(proposed.inspiration.candidates.some(item => item.sourceName === '助手提议' && item.status === 'pending')).toBe(true)
    const connection = (ctx as unknown as { connection: FakeConnection }).connection
    expect(connection.routes).toHaveLength(3)
    const promote = toolService.defs.get('media_promote_card')!
    const card = toolService.defs.get('media_create_card')!
    const created = JSON.parse(String(await card.execute({ title: '工具创建' }))) as { card: { card: { id: string } } }
    const cardId = created.card.card.id
    const refused = JSON.parse(String(await promote.execute({ card_id: cardId, intent_id: 'nope' }))) as { ok: boolean, error?: { code: string } }
    expect(refused.ok).toBe(false)
    expect(refused.error?.code).toBe('user_intent_required')
    await fiber.restart()
    expect((ctx.tools as unknown as FakeTools).defs.has('media_shelve_card')).toBe(true)
    await fiber.dispose()
    expect((ctx.tools as unknown as FakeTools).defs.size).toBe(0)
    expect((ctx as unknown as { connection: FakeConnection }).connection.routes).toHaveLength(0)
  })
})
