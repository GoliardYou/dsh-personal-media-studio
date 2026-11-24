import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AssetLibrary, type AssetHit } from './assets.ts'
import { analyzeCard, createLlmBridge, planDraft, reviewEdit, type LlmBridge, type Maturity } from './ai.ts'
import type { StudioConfig } from './config.ts'
import { StudioDb } from './db.ts'
import { textToSpans, type PageModel, type TemplateId } from './model.ts'
import { PAGE_H, PAGE_W, renderPageHtml, renderPagePng, type RenderAsset } from './render.ts'
import { toXhsMarkdown } from './brand/markdown.ts'
import { pageInner, themeCss, shotCss, normalizeTheme, type BrandSize } from './brand/html.ts'
import { mergeExcludes } from './library/profile.ts'
import { spawn } from 'node:child_process'
import { StudioError, fingerprint, nowIso, parseJson, uid } from './util.ts'

interface Intent {
  id: string
  cardId: string
  action: 'promote' | 'produce'
  at: number
}

const RECOMMENDED = [
  ['为什么我愿意为「慢」付钱', '把一个被当成缺点的体验，写成你自己的判断。'],
  ['产品图拍完，评论区却在说另一件事', '画面和读者真正记住的句子，往往不是同一件。'],
  ['把一次差评写成可复用的判断', '差评不是事故记录，它是下一条内容的原料。'],
  ['本地素材库里已经有答案', '先翻自己拍过的图和写过的笔记，再决定要不要新拍。'],
  ['小标题比金句更难写', '金句负责被截图，小标题负责让人读完。'],
]

export class StudioRuntime {
  readonly db: StudioDb
  readonly assets: AssetLibrary
  readonly llm: LlmBridge
  private timer: NodeJS.Timeout | undefined
  private busy = false
  private closed = false
  private readonly intents = new Map<string, Intent>()
  readonly dataDir: string
  readonly exportDir: string

  private constructor(
    db: StudioDb,
    assets: AssetLibrary,
    llm: LlmBridge,
    dataDir: string,
    exportDir: string,
    private readonly config: StudioConfig,
  ) {
    this.db = db
    this.assets = assets
    this.llm = llm
    this.dataDir = dataDir
    this.exportDir = exportDir
  }

  static async open(ctx: Context, config: StudioConfig) {
    const dataDir = config.dataDir ? resolve(config.dataDir) : join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'personal-media-studio')
    const exportDir = config.exportDir ? resolve(config.exportDir) : join(dataDir, 'exports')
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(exportDir, { recursive: true })
    const db = new StudioDb(join(dataDir, 'studio.sqlite'))
    recoverJobs(db)
    const assets = new AssetLibrary(db, config.libraryRoots.map(root => resolve(root)), mergeExcludes(config.libraryProfile, config.excludeGlobs), join(dataDir, 'thumbs'), config.ocr.command)
    await assets.start(config.watch)
    const llm = createLlmBridge(ctx, config.llm.provider, config.llm.model)
    const runtime = new StudioRuntime(db, assets, llm, dataDir, exportDir, config)
    runtime.seedTopics()
    runtime.timer = setInterval(() => { void runtime.pump() }, 400)
    return runtime
  }

  async dispose() {
    if (this.closed) return
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    await this.assets.stop()
    this.db.close()
  }

  backup(dest?: string) {
    const file = dest ?? join(this.dataDir, 'backups', `studio-${Date.now()}.sqlite`)
    this.db.backup(file)
    return file
  }

  engineInfo() {
    return {
      mode: this.llm.configured ? 'llm' as const : 'heuristic' as const,
      provider: this.config.llm.provider,
      model: this.config.llm.model,
      reason: this.llm.reason,
      sendImagesToCloud: this.config.privacy.sendImagesToCloud,
    }
  }

  bootstrap() {
    return {
      engine: this.engineInfo(),
      libraryCount: (this.db.db.prepare(`SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL`).get() as { n: number }).n,
      templates: this.db.db.prepare(`SELECT id, name, template, tokens_json, builtin FROM style_profiles ORDER BY builtin DESC, name`).all(),
      cards: this.listCards(),
    }
  }

  private seedTopics() {
    const count = this.db.db.prepare(`SELECT COUNT(*) AS n FROM cards`).get() as { n: number }
    if (count.n > 0) return
    const qa = this.db.db.prepare(`SELECT title, text_content FROM assets WHERE deleted_at IS NULL AND rel_path LIKE '%Xhs_QA%' ORDER BY title LIMIT 8`).all() as Array<{ title: string, text_content: string }>
    const seeds = qa.length > 0 ? qa.map(row => [row.title.replace(/\.md$/i, ''), row.text_content.replace(/^#.*\n+/, '').replace(/\s+/g, ' ').slice(0, 72)] as [string, string]) : RECOMMENDED
    const stamp = nowIso()
    for (const [title, summary] of seeds) {
      const topicId = uid()
      this.db.db.prepare(`INSERT INTO topics(id, title, summary, source, created_at, updated_at) VALUES (?, ?, ?, 'ai', ?, ?)`).run(topicId, title, summary, stamp, stamp)
      const cardId = uid()
      this.db.db.prepare(`INSERT INTO cards(id, topic_id, title, status, maturity, input_version, source, created_at, updated_at) VALUES (?, ?, ?, 'open', 'seed', 0, 'ai', ?, ?)`).run(cardId, topicId, title, stamp, stamp)
      this.db.indexText('card', cardId, `${title}\n${summary}`)
    }
  }

  listCards() {
    const cards = this.db.db.prepare(`
      SELECT c.*, t.summary AS topic_summary
      FROM cards c LEFT JOIN topics t ON t.id = c.topic_id
      WHERE c.deleted_at IS NULL
      ORDER BY c.updated_at DESC
    `).all() as Array<Record<string, unknown>>
    return cards.map(card => ({
      ...card,
      latestThesis: (this.db.db.prepare(`SELECT thesis, maturity FROM ai_analyses WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(card.id as string) as { thesis: string, maturity: string } | undefined)?.thesis ?? (card.topic_summary as string | null) ?? '',
    }))
  }

  createCard(title: string) {
    const name = title.trim() || '未命名卡片'
    const stamp = nowIso()
    const topicId = uid()
    const cardId = uid()
    this.db.tx(() => {
      this.db.db.prepare(`INSERT INTO topics(id, title, summary, source, created_at, updated_at) VALUES (?, ?, '', 'user', ?, ?)`).run(topicId, name, stamp, stamp)
      this.db.db.prepare(`INSERT INTO cards(id, topic_id, title, status, maturity, input_version, source, created_at, updated_at) VALUES (?, ?, ?, 'open', 'seed', 0, 'user', ?, ?)`).run(cardId, topicId, name, stamp, stamp)
      this.db.indexText('card', cardId, name)
    })
    return this.getCard(cardId)
  }

  getCard(cardId: string) {
    const card = this.requireCard(cardId, true)
    const interactions = this.db.db.prepare(`SELECT * FROM interactions WHERE card_id = ? ORDER BY created_at ASC`).all(cardId)
    const analysis = this.db.db.prepare(`SELECT * FROM ai_analyses WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(cardId) as Record<string, unknown> | undefined
    const suggestions = this.db.db.prepare(`SELECT * FROM ai_suggestions WHERE card_id = ? ORDER BY created_at ASC`).all(cardId)
    const job = this.db.db.prepare(`SELECT id, status, error, input_version FROM jobs WHERE card_id = ? AND type = 'analyze' ORDER BY created_at DESC LIMIT 1`).get(cardId)
    return {
      card,
      interactions,
      analysis: analysis ? decodeAnalysis(analysis) : null,
      suggestions,
      job,
    }
  }

  appendThought(cardId: string, body: string, attachmentAssetIds: string[] = []) {
    const text = body.trim()
    if (!text && attachmentAssetIds.length === 0) throw new StudioError('empty_thought', '写下一句再保存。')
    const card = this.requireCard(cardId)
    const stamp = nowIso()
    const nextVersion = Number(card.input_version) + 1
    this.db.tx(() => {
      this.db.db.prepare(`INSERT INTO interactions(id, card_id, kind, body, attachments_json, created_at) VALUES (?, ?, 'thought', ?, ?, ?)`).run(uid(), cardId, text, JSON.stringify(attachmentAssetIds), stamp)
      this.db.db.prepare(`UPDATE cards SET input_version = ?, status = 'open', updated_at = ? WHERE id = ?`).run(nextVersion, stamp, cardId)
      this.db.indexText('card', cardId, `${card.title}\n${this.rawText(cardId)}`)
    })
    this.enqueueAnalyze(cardId, nextVersion)
    return this.getCard(cardId)
  }

  shelve(cardId: string) {
    const card = this.requireCard(cardId)
    const stamp = nowIso()
    this.db.db.prepare(`UPDATE cards SET status = 'shelved', updated_at = ? WHERE id = ?`).run(stamp, cardId)
    this.enqueueAnalyze(cardId, Number(card.input_version))
    return this.getCard(cardId)
  }

  renameCard(cardId: string, title: string) {
    const card = this.requireCard(cardId)
    const stamp = nowIso()
    const nextVersion = Number(card.input_version) + 1
    this.db.db.prepare(`UPDATE cards SET title = ?, input_version = ?, updated_at = ? WHERE id = ?`).run(title.trim() || card.title, nextVersion, stamp, cardId)
    this.enqueueAnalyze(cardId, nextVersion)
    return this.getCard(cardId)
  }

  deleteCard(cardId: string) {
    this.requireCard(cardId)
    const stamp = nowIso()
    this.db.db.prepare(`UPDATE cards SET deleted_at = ?, status = 'deleted', updated_at = ? WHERE id = ?`).run(stamp, stamp, cardId)
    this.db.db.prepare(`UPDATE jobs SET status = 'skipped', error = 'card deleted', updated_at = ? WHERE card_id = ? AND status IN ('queued', 'running')`).run(stamp, cardId)
    return { id: cardId, deleted: true }
  }

  restoreCard(cardId: string) {
    const card = this.requireCard(cardId, true)
    if (!card.deleted_at) return this.getCard(cardId)
    this.db.db.prepare(`UPDATE cards SET deleted_at = NULL, status = 'open', updated_at = ? WHERE id = ?`).run(nowIso(), cardId)
    return this.getCard(cardId)
  }

  issueIntent(cardId: string, action: 'promote' | 'produce') {
    this.requireCard(cardId)
    const intent: Intent = { id: uid(), cardId, action, at: Date.now() }
    this.intents.set(intent.id, intent)
    return intent.id
  }

  promote(cardId: string, intentId: string) {
    this.consumeIntent(cardId, 'promote', intentId)
    const card = this.requireCard(cardId)
    if (Number(card.input_version) === 0) throw new StudioError('empty_card', '先写下想法，再决定进入生产。')
    this.db.db.prepare(`UPDATE cards SET status = 'ready_for_production', updated_at = ? WHERE id = ?`).run(nowIso(), cardId)
    return this.getCard(cardId)
  }

  previewAssets() {
    return (this.db.db.prepare(`SELECT id, abs_path AS absPath, title FROM assets WHERE deleted_at IS NULL`).all() as Array<{ id: string, absPath: string, title: string }>)
  }

  textGate(cardId: string) {
    const card = this.requireCard(cardId)
    const verbatim = this.rawText(cardId)
    const published = this.db.db.prepare(`SELECT title FROM assets WHERE deleted_at IS NULL AND (rel_path LIKE '%Archive_%' OR rel_path LIKE '%Deliverables_%')`).all() as Array<{ title: string }>
    const clash = published.map(row => row.title.replace(/\.md$/i, '')).find(title => title && (String(card.title).includes(title) || title.includes(String(card.title))))
    return {
      cardId,
      title: String(card.title),
      verbatim,
      note: '这是你写过的原话。建议只供参考，确认之前不会改写，也不会进入排版。',
      suggestions: [{ id: 'keep-wording', kind: 'guidance', text: '排版时保留原句，只加分节和你点过的加粗。' }],
      warnings: /元|退款|¥|￥/.test(verbatim) ? ['文里有价格或退款表述，导出时标为待确认，不会自动沿用。'] : [],
      duplicate: clash ? `和已发布「${clash}」可能撞题。` : '',
    }
  }

  async startProduction(cardId: string, intentId: string) {
    this.consumeIntent(cardId, 'produce', intentId)
    const card = this.requireCard(cardId)
    if (card.status !== 'ready_for_production' && card.status !== 'in_production' && card.status !== 'reviewing') {
      throw new StudioError('not_ready', '只有你明确推进之后，才能开始生产。')
    }
    const text = this.rawText(cardId)
    const { plan, engine } = await planDraft(this.llm, `${card.title}\n${text}`)
    const hits = this.assets.search(`${card.title}\n${text}`, 6)
    const stamp = nowIso()
    const existing = this.db.db.prepare(`SELECT id FROM projects WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(cardId) as { id: string } | undefined
    const projectId = existing?.id ?? uid()
    const draftId = uid()
    const pages = plan.pages.map((page, ordinal) => this.pageFromPlan(page, ordinal, plan.highlights, hits.filter(hit => hit.kind === 'image')))
    this.db.tx(() => {
      if (!existing) {
        this.db.db.prepare(`INSERT INTO projects(id, card_id, status, template, created_at, updated_at) VALUES (?, ?, 'drafting', 'avatar-green', ?, ?)`).run(projectId, cardId, stamp, stamp)
      } else {
        this.db.db.prepare(`UPDATE projects SET status = 'drafting', updated_at = ? WHERE id = ?`).run(stamp, projectId)
      }
      this.db.db.prepare(`INSERT INTO drafts(id, project_id, title, body_md, structure_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(
        draftId, projectId, plan.title, text, JSON.stringify({ plan, engine, highlights: plan.highlights }), stamp, stamp,
      )
      const insertPage = this.db.db.prepare(`INSERT INTO draft_pages(id, draft_id, ordinal, role, title, blocks_json, style_json) VALUES (?, ?, ?, ?, ?, ?, '{}')`)
      for (const page of pages) insertPage.run(page.id, draftId, page.ordinal, page.role, page.title, JSON.stringify(page.blocks))
      const insertRel = this.db.db.prepare(`INSERT INTO asset_relations(id, project_id, draft_page_id, asset_id, status, rationale, source_path, crop_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'suggested', ?, ?, '{}', ?, ?)`)
      const seenAssets = new Set<string>()
      for (const hit of hits) {
        if (seenAssets.has(hit.assetId)) continue
        seenAssets.add(hit.assetId)
        const page = pages.find(item => item.blocks.some(block => block.assetId === hit.assetId))
        insertRel.run(uid(), projectId, page?.id ?? null, hit.assetId, hit.rationale, hit.sourcePath, stamp, stamp)
      }
      this.db.db.prepare(`UPDATE cards SET status = 'in_production', updated_at = ? WHERE id = ?`).run(stamp, cardId)
    })
    return this.getProject(cardId)
  }

  getProject(cardId: string) {
    const project = this.db.db.prepare(`SELECT * FROM projects WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(cardId) as Record<string, unknown> | undefined
    if (!project) return null
    const draft = this.db.db.prepare(`SELECT * FROM drafts WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).get(project.id as string) as Record<string, unknown> | undefined
    if (!draft) return { project, draft: null, pages: [], relations: [] }
    const pages = this.readPages(draft.id as string)
    const relations = this.db.db.prepare(`SELECT * FROM asset_relations WHERE project_id = ? ORDER BY created_at ASC`).all(project.id as string)
    const theme = normalizeTheme(String(project.template || 'avatar-green'))
    let css = ''
    try { css = `${themeCss(theme)}\n${shotCss()}` } catch { css = '' }
    const decorated = pages.map((page, index) => ({
      ...page,
      html: pageInner(page, theme, this.config.render.size, index, pages.length, new Map()),
    }))
    return { project, draft, pages: decorated, relations, themeCss: css }
  }

  decideAsset(relationId: string, decision: 'accepted' | 'rejected' | 'replaced', replacementAssetId?: string, crop?: { x: number, y: number, scale: number }) {
    const relation = this.db.db.prepare(`SELECT * FROM asset_relations WHERE id = ?`).get(relationId) as Record<string, unknown> | undefined
    if (!relation) throw new StudioError('missing_relation', '找不到这条素材关系。')
    const stamp = nowIso()
    if (decision === 'replaced') {
      if (!replacementAssetId) throw new StudioError('missing_asset', '替换时要指定另一条本地素材。')
      const asset = this.assets.get(replacementAssetId)
      if (!asset || asset.deleted_at) throw new StudioError('missing_asset', '替换素材不在本地库中。')
      this.db.db.prepare(`UPDATE asset_relations SET status = 'replaced', updated_at = ? WHERE id = ?`).run(stamp, relationId)
      const id = uid()
      this.db.db.prepare(`INSERT INTO asset_relations(id, project_id, draft_page_id, asset_id, status, rationale, source_path, crop_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?)`).run(
        id, relation.project_id, relation.draft_page_id, replacementAssetId, '由你替换原建议素材。', asset.abs_path, JSON.stringify(crop ?? {}), stamp, stamp,
      )
      this.swapImage(String(relation.draft_page_id), String(relation.asset_id), replacementAssetId, crop)
      return { relationId: id }
    }
    this.db.db.prepare(`UPDATE asset_relations SET status = ?, crop_json = ?, updated_at = ? WHERE id = ?`).run(decision, JSON.stringify(crop ?? parseJson(String(relation.crop_json), {})), stamp, relationId)
    if (decision === 'rejected') this.swapImage(String(relation.draft_page_id), String(relation.asset_id), null)
    if (decision === 'accepted' && crop) this.swapImage(String(relation.draft_page_id), String(relation.asset_id), String(relation.asset_id), crop)
    return { relationId }
  }

  saveDraft(draftId: string, patch: { title?: string, template?: TemplateId, pages?: PageModel[] }) {
    const draft = this.requireDraft(draftId)
    const stamp = nowIso()
    this.db.tx(() => {
      if (patch.template) {
        this.db.db.prepare(`UPDATE projects SET template = ?, updated_at = ? WHERE id = ?`).run(patch.template, stamp, draft.project_id)
      }
      if (patch.title) this.db.db.prepare(`UPDATE drafts SET title = ? WHERE id = ?`).run(patch.title, draftId)
      if (patch.pages) this.writePages(draftId, patch.pages)
      this.db.db.prepare(`UPDATE drafts SET version = version + 1, updated_at = ? WHERE id = ?`).run(stamp, draftId)
      this.db.db.prepare(`UPDATE cards SET status = 'reviewing', updated_at = ? WHERE id = (SELECT card_id FROM projects WHERE id = ?)`).run(stamp, draft.project_id)
    })
    return this.projectByDraft(draftId)
  }

  snapshot(draftId: string, label: string) {
    const draft = this.requireDraft(draftId)
    const pages = this.readPages(draftId)
    const project = this.db.db.prepare(`SELECT template FROM projects WHERE id = ?`).get(draft.project_id) as { template: string }
    const id = uid()
    this.db.db.prepare(`INSERT INTO versions(id, draft_id, label, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id, draftId, label || `版本 ${draft.version}`, JSON.stringify({ title: draft.title, template: project.template, pages }), nowIso(),
    )
    return { id }
  }

  listVersions(draftId: string) {
    this.requireDraft(draftId)
    return this.db.db.prepare(`SELECT id, label, created_at FROM versions WHERE draft_id = ? ORDER BY created_at DESC`).all(draftId)
  }

  restoreVersion(versionId: string) {
    const version = this.db.db.prepare(`SELECT * FROM versions WHERE id = ?`).get(versionId) as { id: string, draft_id: string, snapshot_json: string } | undefined
    if (!version) throw new StudioError('missing_version', '找不到这个版本。')
    const snapshot = parseJson<{ title: string, template: TemplateId, pages: PageModel[] }>(version.snapshot_json, { title: '', template: 'knowledge', pages: [] })
    return this.saveDraft(version.draft_id, snapshot)
  }

  async proposeEdit(draftId: string, pageId: string, instruction: string) {
    const pages = this.readPages(draftId)
    const page = pages.find(item => item.id === pageId)
    if (!page) throw new StudioError('missing_page', '找不到这一页。')
    const text = page.blocks.filter(block => block.type === 'paragraph').map(block => block.spans?.map(span => span.text).join('') ?? block.text ?? '').join('\n')
    const edited = await reviewEdit(this.llm, text, instruction)
    return { pageId, paragraphs: edited.paragraphs, engine: edited.engine, instruction }
  }

  confirmEdit(draftId: string, pageId: string, paragraphs: string[]) {
    const pages = this.readPages(draftId)
    const page = pages.find(item => item.id === pageId)
    if (!page) throw new StudioError('missing_page', '找不到这一页。')
    const others = page.blocks.filter(block => block.type !== 'paragraph')
    page.blocks = [
      ...paragraphs.map(text => ({ id: uid(), type: 'paragraph' as const, spans: textToSpans(text) })),
      ...others,
    ]
    return this.saveDraft(draftId, { pages })
  }

  async exportProject(cardId: string) {
    const loaded = this.getProject(cardId)
    if (!loaded?.draft) throw new StudioError('missing_project', '还没有可导出的稿件。')
    const draftId = loaded.draft.id as string
    const version = this.snapshot(draftId, '导出')
    const pages = this.readPages(draftId)
    const template = normalizeTheme(String(loaded.project.template || 'avatar-green'))
    const size = this.config.render.size
    const assetRows = (this.db.db.prepare(`SELECT id, abs_path, title FROM assets WHERE deleted_at IS NULL`).all() as Array<{ id: string, abs_path: string, title: string }>).map(row => ({ id: row.id, absPath: row.abs_path, title: row.title })) satisfies RenderAsset[]
    const dir = join(this.exportDir, String(loaded.project.id), stampDir())
    const pageDir = join(dir, 'pages')
    mkdirSync(pageDir, { recursive: true })
    const files: string[] = []
    let usedEngine = ''
    for (const [index, page] of pages.entries()) {
      const rendered = await renderPagePng(page, template, assetRows, this.config.render.engine, index, pages.length, size)
      usedEngine = rendered.engine
      const name = `${String(index + 1).padStart(2, '0')}-${page.role}.png`
      writeFileSync(join(pageDir, name), rendered.png)
      files.push(`pages/${name}`)
    }
    const body = pages.map(page => {
      const lines = [`## ${page.title}`]
      for (const block of page.blocks) {
        if (block.type === 'paragraph') lines.push(block.spans?.map(span => span.bold ? `**${span.text}**` : span.text).join('') ?? '')
        if (block.type === 'quote') lines.push(`> ${block.text ?? ''}`)
        if (block.type === 'image') lines.push(`![${block.caption ?? ''}](asset:${block.assetId ?? ''})`)
      }
      return lines.join('\n\n')
    }).join('\n\n')
    writeFileSync(join(dir, 'body.md'), `# ${loaded.draft.title}\n\n${body}\n`, 'utf8')
    const article = toXhsMarkdown({
      title: String(loaded.draft.title),
      subtitle: pages.find(page => page.role === 'cover')?.blocks.find(block => block.type === 'paragraph')?.spans?.map(span => span.text).join('') || String(loaded.draft.title),
      theme: template,
      size,
      coverTitle: pages.find(page => page.role === 'cover')?.title || String(loaded.draft.title),
      author: this.config.brand.author,
      role: this.config.brand.role,
      sections: pages.filter(page => page.role !== 'cover').map(page => ({
        heading: page.title,
        paragraphs: page.blocks.filter(block => block.type === 'paragraph').map(block => block.spans?.map(span => span.bold ? `**${span.text}**` : span.text).join('') ?? ''),
      })),
      quotes: pages.flatMap(page => page.blocks.filter(block => block.type === 'quote').map(block => block.text ?? '')),
      screenshots: pages.flatMap(page => page.blocks.filter(block => block.type === 'image' && block.assetId).map(block => ({ src: assetRows.find(asset => asset.id === block.assetId)?.absPath ?? '', caption: block.caption }))),
      products: [{ name: String(loaded.draft.title), tagline: '结构见正文，价格与获取方式待确认', points: ['待确认'] }],
    })
    writeFileSync(join(dir, 'article.md'), article, 'utf8')
    if (this.config.render.engine === 'xhs_render' && this.config.render.xhsRenderPy) {
      await runXhsRender(this.config.render.xhsRenderPy, join(dir, 'article.md'), pageDir, template, size)
    }
    writeFileSync(join(dir, 'body.txt'), `${loaded.draft.title}\n\n${body.replace(/[#>*[\]]/g, '')}\n`, 'utf8')
    const structure = { title: loaded.draft.title, template, width: PAGE_W, height: PAGE_H, pages }
    writeFileSync(join(dir, 'structure.json'), JSON.stringify(structure, null, 2))
    const manifestAssets = (loaded.relations as Array<Record<string, unknown>>).map(relation => ({
      relationId: relation.id,
      assetId: relation.asset_id,
      status: relation.status,
      sourcePath: relation.source_path,
      rationale: relation.rationale,
      crop: parseJson(String(relation.crop_json ?? '{}'), {}),
    }))
    writeFileSync(join(dir, 'assets.json'), JSON.stringify({ assets: manifestAssets }, null, 2))
    const versionInfo = { versionId: version.id, draftVersion: loaded.draft.version, exportedAt: nowIso(), renderer: usedEngine, page: { width: PAGE_W, height: PAGE_H } }
    writeFileSync(join(dir, 'version.json'), JSON.stringify(versionInfo, null, 2))
    const knowledge = this.writeKnowledge(String(loaded.draft.title), body, dir)
    const manifest = { dir, files: [...files, 'body.md', 'body.txt', 'structure.json', 'assets.json', 'version.json'], knowledge, version: versionInfo, htmlPreview: pages.map(page => renderPageHtml(page, template, assetRows)).length }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const exportId = uid()
    this.db.db.prepare(`INSERT INTO exports(id, project_id, version_id, dir, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(exportId, loaded.project.id, version.id, dir, JSON.stringify(manifest), nowIso())
    this.db.db.prepare(`UPDATE cards SET status = 'exported', updated_at = ? WHERE id = ?`).run(nowIso(), cardId)
    this.db.db.prepare(`UPDATE projects SET status = 'exported', updated_at = ? WHERE id = ?`).run(nowIso(), loaded.project.id)
    return { exportId, dir, manifest, files }
  }

  searchAssets(query: string) {
    return this.assets.search(query, 12)
  }

  async drain() {
    let progressed = true
    while (progressed) progressed = await this.pump()
  }

  private writeKnowledge(title: string, body: string, exportDir: string) {
    const root = this.config.libraryRoots[0] ? resolve(this.config.libraryRoots[0]) : join(this.dataDir, 'knowledge')
    mkdirSync(root, { recursive: true })
    const file = join(root, `回写-${title.replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '稿件'}.md`)
    const note = `# ${title}\n\n这条笔记由个人媒体工作室在导出后回写，供下次检索。\n\n- 导出目录：\`${exportDir}\`\n\n${body}\n`
    writeFileSync(file, note, 'utf8')
    return file
  }

  private pageFromPlan(page: { role: 'cover' | 'content' | 'quote', kicker: string, title: string, paragraphs: string[], quote?: string }, ordinal: number, highlights: string[], hits: AssetHit[]): PageModel {
    const blocks: PageModel['blocks'] = page.paragraphs.map(text => ({ id: uid(), type: 'paragraph' as const, spans: textToSpans(text, highlights) }))
    const image = hits.length > 0 ? hits[ordinal % hits.length] : undefined
    if (image && page.role !== 'quote') {
      blocks.push({
        id: uid(),
        type: 'image',
        assetId: image.assetId,
        caption: image.title,
        crop: { x: 50, y: 50, scale: 1 },
      })
    }
    if (page.quote) blocks.push({ id: uid(), type: 'quote', text: page.quote })
    return { id: uid(), ordinal, role: page.role, kicker: page.kicker, title: page.title, blocks, style: {} }
  }

  private swapImage(pageId: string, fromAsset: string, toAsset: string | null, crop?: { x: number, y: number, scale: number }) {
    const row = this.db.db.prepare(`SELECT draft_id, blocks_json FROM draft_pages WHERE id = ?`).get(pageId) as { draft_id: string, blocks_json: string } | undefined
    if (!row) return
    const pages = this.readPages(row.draft_id)
    const page = pages.find(item => item.id === pageId)
    if (!page) return
    page.blocks = page.blocks.filter(block => !(block.type === 'image' && block.assetId === fromAsset))
    if (toAsset) {
      const asset = this.assets.get(toAsset)
      page.blocks.push({ id: uid(), type: 'image', assetId: toAsset, caption: String(asset?.title ?? ''), crop: crop ?? { x: 50, y: 40, scale: 1 } })
    }
    this.writePages(row.draft_id, pages)
  }

  private readPages(draftId: string): PageModel[] {
    const rows = this.db.db.prepare(`SELECT * FROM draft_pages WHERE draft_id = ? ORDER BY ordinal ASC`).all(draftId) as Array<Record<string, unknown>>
    return rows.map(row => {
      const style = parseJson<PageModel['style'] & { kicker?: string }>(String(row.style_json), {})
      const kicker = style.kicker || (row.role === 'cover' ? '封面' : row.role === 'quote' ? '金句' : '内页')
      delete style.kicker
      return {
        id: String(row.id),
        ordinal: Number(row.ordinal),
        role: row.role as PageModel['role'],
        kicker,
        title: String(row.title),
        blocks: parseJson(String(row.blocks_json), []),
        style,
      }
    })
  }

  private writePages(draftId: string, pages: PageModel[]) {
    this.db.db.prepare(`DELETE FROM draft_pages WHERE draft_id = ?`).run(draftId)
    const insert = this.db.db.prepare(`INSERT INTO draft_pages(id, draft_id, ordinal, role, title, blocks_json, style_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    pages.forEach((page, ordinal) => {
      insert.run(page.id || uid(), draftId, ordinal, page.role, page.title, JSON.stringify(page.blocks), JSON.stringify({ ...(page.style ?? {}), kicker: page.kicker }))
    })
  }

  private requireDraft(draftId: string) {
    const draft = this.db.db.prepare(`SELECT * FROM drafts WHERE id = ?`).get(draftId) as { id: string, project_id: string, title: string, version: number } | undefined
    if (!draft) throw new StudioError('missing_draft', '找不到稿件。')
    return draft
  }

  private projectByDraft(draftId: string) {
    const draft = this.requireDraft(draftId)
    const project = this.db.db.prepare(`SELECT card_id FROM projects WHERE id = ?`).get(draft.project_id) as { card_id: string }
    return this.getProject(project.card_id)
  }

  private consumeIntent(cardId: string, action: Intent['action'], intentId: string) {
    const intent = this.intents.get(intentId)
    if (!intent || intent.cardId !== cardId || intent.action !== action || Date.now() - intent.at > 120_000) {
      throw new StudioError('user_intent_required', '这一步只能由你在界面上明确确认，模型不能单独推进。')
    }
    this.intents.delete(intentId)
  }

  private requireCard(cardId: string, allowDeleted = false) {
    const card = this.db.db.prepare(`SELECT * FROM cards WHERE id = ?`).get(cardId) as Record<string, unknown> | undefined
    if (!card || (!allowDeleted && card.deleted_at)) throw new StudioError('missing_card', '找不到这张卡片。')
    return card
  }

  private rawText(cardId: string) {
    const rows = this.db.db.prepare(`SELECT body FROM interactions WHERE card_id = ? AND kind = 'thought' ORDER BY created_at ASC`).all(cardId) as Array<{ body: string }>
    return rows.map(row => row.body).filter(Boolean).join('\n')
  }

  private enqueueAnalyze(cardId: string, inputVersion: number) {
    const existing = this.db.db.prepare(`SELECT id FROM jobs WHERE card_id = ? AND type = 'analyze' AND status IN ('queued','running') AND input_version = ?`).get(cardId, inputVersion)
    if (existing) return
    const stamp = nowIso()
    this.db.db.prepare(`INSERT INTO jobs(id, type, card_id, input_version, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at) VALUES (?, 'analyze', ?, ?, '{}', 'queued', 0, 3, ?, ?, ?)`).run(uid(), cardId, inputVersion, stamp, stamp, stamp)
  }

  private async pump(): Promise<boolean> {
    if (this.busy || this.closed) return false
    const job = this.db.db.prepare(`SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at ASC LIMIT 1`).get(nowIso()) as Record<string, unknown> | undefined
    if (!job) return false
    this.busy = true
    const stamp = nowIso()
    this.db.db.prepare(`UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(stamp, stamp, job.id)
    try {
      const outcome = await this.runJob(job)
      if (outcome !== 'skipped') {
        this.db.db.prepare(`UPDATE jobs SET status = 'done', updated_at = ?, error = NULL WHERE id = ?`).run(nowIso(), job.id)
      }
    } catch (error) {
      const attempts = Number(job.attempts) + 1
      const message = error instanceof Error ? error.message : String(error)
      if (attempts >= Number(job.max_attempts)) {
        this.db.db.prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(message, nowIso(), job.id)
      } else {
        const retry = new Date(Date.now() + attempts * 500).toISOString()
        this.db.db.prepare(`UPDATE jobs SET status = 'queued', error = ?, run_after = ?, updated_at = ? WHERE id = ?`).run(message, retry, nowIso(), job.id)
      }
    } finally {
      this.busy = false
    }
    return true
  }

  private async runJob(job: Record<string, unknown>): Promise<'done' | 'skipped'> {
    if (job.type !== 'analyze' || !job.card_id) return 'done'
    const card = this.db.db.prepare(`SELECT * FROM cards WHERE id = ?`).get(job.card_id) as Record<string, unknown> | undefined
    if (!card || card.deleted_at) {
      this.db.db.prepare(`UPDATE jobs SET status = 'skipped', error = 'card gone', updated_at = ? WHERE id = ?`).run(nowIso(), job.id)
      return 'skipped'
    }
    if (Number(card.input_version) !== Number(job.input_version)) {
      this.db.db.prepare(`UPDATE jobs SET status = 'skipped', error = 'stale input version', updated_at = ? WHERE id = ?`).run(nowIso(), job.id)
      return 'skipped'
    }
    const text = `${card.title}\n${this.rawText(String(card.id))}`.trim()
    const prior = this.db.db.prepare(`SELECT text FROM ai_suggestions WHERE card_id = ? AND kind = 'question'`).all(card.id) as Array<{ text: string }>
    const relatedSeed = this.assets.search(text, 4)
    const result = await analyzeCard(this.llm, {
      text,
      priorQuestions: prior.map(row => row.text),
      assets: relatedSeed.map(hit => ({ id: hit.assetId, text: `${hit.title}\n${hit.sourcePath}` })),
    })
    if (Number((this.db.db.prepare(`SELECT input_version FROM cards WHERE id = ?`).get(card.id) as { input_version: number }).input_version) !== Number(job.input_version)) {
      this.db.db.prepare(`UPDATE jobs SET status = 'skipped', error = 'stale input version', updated_at = ? WHERE id = ?`).run(nowIso(), job.id)
      return 'skipped'
    }
    const related = this.assets.search(`${text}\n${result.analysis.thesis}`, 4)
    const analysisId = uid()
    const stamp = nowIso()
    this.db.tx(() => {
      this.db.db.prepare(`INSERT INTO ai_analyses(id, card_id, input_version, engine, thesis, stories_json, gaps_json, perspectives_json, related_assets_json, maturity, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        analysisId, card.id, job.input_version, result.engine, result.analysis.thesis, JSON.stringify(result.analysis.stories), JSON.stringify(result.analysis.gaps), JSON.stringify(result.analysis.perspectives), JSON.stringify(related), result.analysis.maturity, result.analysis.summary, stamp,
      )
      const insert = this.db.db.prepare(`INSERT INTO ai_suggestions(id, card_id, analysis_id, kind, text, fingerprint, status, created_at) VALUES (?, ?, ?, 'question', ?, ?, 'open', ?)`)
      for (const question of result.analysis.questions) {
        const fp = fingerprint(question)
        const dup = this.db.db.prepare(`SELECT id FROM ai_suggestions WHERE card_id = ? AND fingerprint = ?`).get(card.id, fp)
        if (dup) continue
        insert.run(uid(), card.id, analysisId, question, fp, stamp)
      }
      this.db.db.prepare(`UPDATE cards SET maturity = ?, updated_at = ? WHERE id = ? AND input_version = ?`).run(result.analysis.maturity, stamp, card.id, job.input_version)
    })
    return 'done'
  }

  async handleRpc(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { op?: string, payload?: Record<string, unknown> }
      const op = body.op ?? ''
      const payload = body.payload ?? {}
      const value = await this.dispatch(op, payload)
      return Response.json({ ok: true, value })
    } catch (error) {
      const coded = error instanceof StudioError ? error : new StudioError('internal', error instanceof Error ? error.message : String(error))
      return Response.json({ ok: false, error: { code: coded.code, message: coded.message } }, { status: coded.code === 'internal' ? 500 : 400 })
    }
  }

  handleAsset(request: Request): Response {
    const url = new URL(request.url)
    const id = url.searchParams.get('id') ?? ''
    const asset = this.assets.get(id)
    if (!asset || asset.deleted_at || typeof asset.abs_path !== 'string') {
      return new Response('not found', { status: 404 })
    }
    const rootOk = this.config.libraryRoots.some(root => String(asset.abs_path).startsWith(resolve(root)))
    if (!rootOk) return new Response('forbidden', { status: 403 })
    const bytes = readFileSyncSafe(String(asset.abs_path))
    if (!bytes) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': String(asset.mime || 'application/octet-stream'), 'cache-control': 'no-store' } })
  }

  private async dispatch(op: string, payload: Record<string, unknown>) {
    switch (op) {
      case 'bootstrap': return this.bootstrap()
      case 'createCard': return this.createCard(String(payload.title ?? ''))
      case 'getCard': return this.getCard(String(payload.cardId))
      case 'appendThought': return this.appendThought(String(payload.cardId), String(payload.body ?? ''), arrayOf(payload.attachmentAssetIds))
      case 'shelve': return this.shelve(String(payload.cardId))
      case 'renameCard': return this.renameCard(String(payload.cardId), String(payload.title ?? ''))
      case 'deleteCard': return this.deleteCard(String(payload.cardId))
      case 'restoreCard': return this.restoreCard(String(payload.cardId))
      case 'textGate': return this.textGate(String(payload.cardId))
      case 'previewPage': return { html: (await import('./render.ts')).renderPageHtml(payload.page as PageModel, String(payload.template || 'avatar-green'), this.previewAssets(), this.config.render.size, Number(payload.index || 0), Number(payload.total || 1)) }
      case 'promote': {
        const cardId = String(payload.cardId)
        return this.promote(cardId, this.issueIntent(cardId, 'promote'))
      }
      case 'startProduction': {
        const cardId = String(payload.cardId)
        return this.startProduction(cardId, this.issueIntent(cardId, 'produce'))
      }
      case 'getProject': return this.getProject(String(payload.cardId))
      case 'decideAsset': return this.decideAsset(String(payload.relationId), payload.decision as 'accepted' | 'rejected' | 'replaced', payload.replacementAssetId ? String(payload.replacementAssetId) : undefined, payload.crop as { x: number, y: number, scale: number } | undefined)
      case 'saveDraft': return this.saveDraft(String(payload.draftId), { title: payload.title ? String(payload.title) : undefined, template: payload.template as TemplateId | undefined, pages: payload.pages as PageModel[] | undefined })
      case 'snapshot': return this.snapshot(String(payload.draftId), String(payload.label ?? ''))
      case 'listVersions': return this.listVersions(String(payload.draftId))
      case 'restoreVersion': return this.restoreVersion(String(payload.versionId))
      case 'proposeEdit': return this.proposeEdit(String(payload.draftId), String(payload.pageId), String(payload.instruction ?? ''))
      case 'confirmEdit': return this.confirmEdit(String(payload.draftId), String(payload.pageId), arrayOf(payload.paragraphs))
      case 'exportProject': return this.exportProject(String(payload.cardId))
      case 'searchAssets': return this.searchAssets(String(payload.query ?? ''))
      default: throw new StudioError('unknown_op', `未知操作 ${op}`)
    }
  }
}

function runXhsRender(script: string, markdown: string, outDir: string, theme: string, size: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('python3', [script, markdown, '--theme', theme, '--size', size, '-o', outDir, '--no-zip', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `xhs_render.py exited ${code}`))
    })
  })
}

function recoverJobs(db: StudioDb) {
  db.db.prepare(`UPDATE jobs SET status = 'queued', locked_at = NULL, updated_at = ? WHERE status = 'running'`).run(nowIso())
}

function decodeAnalysis(row: Record<string, unknown>) {
  return {
    ...row,
    stories: parseJson(String(row.stories_json), []),
    gaps: parseJson(String(row.gaps_json), []),
    perspectives: parseJson(String(row.perspectives_json), []),
    relatedAssets: parseJson<AssetHit[]>(String(row.related_assets_json), []),
    maturity: row.maturity as Maturity,
  }
}

function arrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : []
}

function stampDir() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function readFileSyncSafe(file: string): Buffer | null {
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}
