import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createQueue, advanceQueue, queueProgress, type FocusQueue } from './focusQueue'
import { tidySourceText } from './tidy'
import tokens from './tokens.css'
import components from './components.css'
import css from './styles.css'

type StageId = 'topics' | 'drafts' | 'render' | 'inspiration'

interface ClientCtx {
  effect(run: () => void | (() => void)): void
  layout: { selectPanel(id: string | null): void }
  slots: {
    inject(name: string, register: () => unknown): void
    register(meta: Record<string, unknown>, component: (props: { size?: number, active?: boolean }) => ReactElement): unknown
  }
}

const PANELS: Record<StageId, string> = {
  topics: 'personal-media',
  drafts: 'personal-media-drafts',
  render: 'personal-media-render',
  inspiration: 'personal-media-inspiration',
}
const STAGE_LABEL: Record<StageId, string> = { topics: '选题', drafts: '草稿', render: '渲染', inspiration: '灵感' }

function readRoute(fallback: StageId): { stage: StageId, cardId: string | null } {
  const hash = location.hash.replace(/^#/, '')
  const match = hash.match(/^pms\/(topics|drafts|render|inspiration)(?:\/([A-Za-z0-9-]+))?$/)
  if (!match) return { stage: fallback, cardId: null }
  return { stage: match[1] as StageId, cardId: match[2] ?? null }
}

/** 聚焦视图的直达地址：#pms/topics/focus/<cardId>，便于复现和分享某张卡的聚焦状态。 */
function focusRouteId(): string | null {
  const match = location.hash.match(/^#pms\/topics\/focus\/([A-Za-z0-9-]+)$/)
  return match ? match[1] : null
}

interface Span { text: string, bold?: boolean, highlight?: boolean }
interface Block {
  id: string
  type: 'heading' | 'paragraph' | 'quote' | 'image'
  text?: string
  spans?: Span[]
  assetId?: string
  caption?: string
  crop?: { x: number, y: number, scale: number }
}
interface PageModel {
  id: string
  ordinal: number
  role: 'cover' | 'content' | 'quote'
  kicker: string
  title: string
  blocks: Block[]
  style: { background?: string, accent?: string, titleSize?: number, bodySize?: number }
}
interface CardRow {
  id: string
  title: string
  status: string
  maturity: string
  source: string
  latestThesis?: string
  ask_count?: number
  updated_at: string
  updatedAt?: string
}
interface StageRow {
  id: string
  title: string
  status: string
  maturity: string
  source: string
  stage: StageId
  updatedAt: string
  projectStatus: string
  template: string
  pageSize: string
}
interface StageBook {
  counts: { topics: number, drafts: number, render: number, inspiration?: number }
  topics: StageRow[]
  drafts: StageRow[]
  render: StageRow[]
}
interface InspirationSource {
  id: string
  kind: string
  name: string
  status: 'connected' | 'not_connected' | string
  detail: string
  lastSyncAt?: string | null
}
interface InspirationItem {
  id: string
  sourceId: string
  title: string
  body: string
  url: string
  provenance: string
  capturedAt: string
}
interface InspirationCandidate {
  id: string
  itemId: string
  angle: string
  why: string
  status: 'pending' | 'approved' | 'rejected'
  cardId?: string | null
  createdAt: string
  decidedAt?: string | null
  itemTitle: string
  itemBody: string
  itemUrl: string
  itemProvenance: string
  itemCapturedAt: string
  sourceId: string
  sourceName: string
  sourceKind: string
}
interface InspirationView {
  sources: InspirationSource[]
  items: InspirationItem[]
  candidates: InspirationCandidate[]
  counts: { pending: number, approved: number, rejected: number }
}
interface PoolTopic {
  id: string
  title: string
  askCount: number
  summary: string
}
interface AssetHit {
  assetId: string
  title: string
  sourcePath: string
  kind: string
  rationale: string
  score: number
}
interface AnalysisView {
  engine: string
  thesis: string
  summary: string
  maturity: string
  stories: string[]
  gaps: string[]
  perspectives: Array<{ stance: string, counter: string }>
  relatedAssets: AssetHit[]
}
interface InspirationImage {
  assetId: string
  file: string
}
interface CardInspiration {
  questions: string[]
  answer: string
  images: InspirationImage[]
  askCount: number
  newest?: string
}
interface CardDetail {
  card: CardRow & { input_version: number }
  topicSummary?: string
  askCount?: number
  sourceAssetId?: string | null
  sourceFile?: string
  inspiration?: CardInspiration | null
  interactions: Array<{ id: string, body: string, created_at: string, edited_at?: string | null, attachments_json: string }>
  analysis: AnalysisView | null
  suggestions: Array<{ id: string, kind: string, text: string, status: string }>
  job: { status?: string } | null
}
interface ProjectView {
  project: { id: string, template: string, status: string, page_size?: string }
  draft: { id: string, title: string, version: number }
  pages: Array<PageModel & { html?: string }>
  relations: Array<{ id: string, asset_id: string, status: string, rationale: string, source_path: string, draft_page_id: string }>
  themeCss?: string
}

const THEMES = {
  'avatar-green': { paper: '#F5F6F0', ink: '#1E5A43', accent: '#D4A54A', font: '"Noto Serif CJK SC","Songti SC",serif', quote: '#F2E2A0' },
  'navy-gold': { paper: '#F6F1E8', ink: '#102A3C', accent: '#B8903A', font: '"Noto Serif CJK SC","Songti SC",serif', quote: '#E8D29A' },
  gongwen: { paper: '#FFFFFF', ink: '#000000', accent: '#000000', font: '"FandolFang","FangSong","Noto Serif CJK SC",serif', quote: '#F4F4F4' },
} as const

async function rpc<T>(op: string, payload?: object): Promise<T> {
  const response = await fetch('/api/personal-media-studio/rpc', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, payload: payload ?? {} }),
  })
  const body = await response.json() as { ok: boolean, value?: T, error?: { message: string } }
  if (!body.ok) throw new Error(body.error?.message || '工作室暂时没有响应')
  return body.value as T
}

function assetUrl(id: string) {
  return `/api/personal-media-studio/asset?id=${encodeURIComponent(id)}`
}

/**
 * 灵感：默认只留一行「一句话 + 原始素材」。
 * 展开后按原文排版，图片点开看大图；这里不做任何改写、摘要或截断。
 */
function Inspiration({ data }: { data: CardInspiration }) {
  const [open, setOpen] = useState(false)
  const [viewer, setViewer] = useState<InspirationImage | null>(null)
  // 只在展示层整理空白与断行；data 里的原文不做任何改写。
  const questions = data.questions.map(tidySourceText).filter(Boolean)
  const answer = tidySourceText(data.answer)
  const lead = questions[0] || answer.split('\n')[0] || '原始截图'

  // 大图打开时，Esc 只关大图；用捕获阶段拦下，避免聚焦模式把 Esc 当成「退出聚焦」。
  useEffect(() => {
    if (!viewer) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setViewer(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [viewer])

  return (
    <>
      <section className="pms-inspiration" data-testid="inspiration">
        <div className="pms-inspiration__line">
          <span className="pms-inspiration__label">灵感</span>
          <span className="pms-inspiration__lead" title={lead}>{lead}</span>
          {Number(data.askCount) > 0 && <span className="pms-inspiration__meta">{data.askCount} 人问过</span>}
          <button type="button" className="pms-inspiration__toggle" aria-expanded={open} onClick={() => setOpen(value => !value)} data-testid="inspiration-toggle">{open ? '收起' : '原始素材'}</button>
        </div>
        {open && (
          <div className="pms-inspiration__body">
            <p className="pms-inspiration__note">原文照录，未改写</p>
            {questions.length > 0 && (
              <div className="pms-inspiration__section">
                <h4>提问</h4>
                <ol>{questions.map(question => <li key={question}>{question}</li>)}</ol>
              </div>
            )}
            {answer && (
              <div className="pms-inspiration__section">
                <h4>回答</h4>
                <p>{answer}</p>
              </div>
            )}
            {data.images.length > 0 && (
              <div className="pms-inspiration__section">
                <h4>截图<span>点开看大图</span></h4>
                <div className="pms-inspiration__shots">
                  {data.images.map(image => (
                    <button key={image.assetId} type="button" className="pms-inspiration__shot" aria-label="查看原始截图大图" onClick={() => setViewer(image)}>
                      <img src={assetUrl(image.assetId)} alt={image.file || '原始截图'} loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      {viewer && (
        <div className="pms-lightbox" role="dialog" aria-modal="true" aria-label="原始截图" onClick={event => { if (event.target === event.currentTarget) setViewer(null) }}>
          <figure className="pms-lightbox__figure">
            <button type="button" className="pms-lightbox__close" aria-label="关闭大图" autoFocus onClick={() => setViewer(null)}>×</button>
            <img src={assetUrl(viewer.assetId)} alt={viewer.file || '原始截图'} />
            {viewer.file && <figcaption>{viewer.file}</figcaption>}
          </figure>
        </div>
      )}
    </>
  )
}

function spanText(spans?: Span[], fallback = '') {
  return spans?.map(span => span.text).join('') || fallback
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    open: '进行中', shelved: '已搁置', ready_for_production: '待写正文', in_production: '改稿中', drafting: '改稿中', reviewing: '待渲染', exported: '已导出', paused: '已退回选题', deleted: '已删除',
  }
  return map[status] ?? status
}

function maturityLabel(maturity: string) {
  const map: Record<string, string> = { seed: '种子阶段', exploring: '构思中', forming: '逐渐成形', mature: '可生产' }
  return map[maturity] ?? maturity
}

function roleLabel(role: string) {
  const map: Record<string, string> = { cover: '封面', content: '内页', quote: '金句' }
  return map[role] ?? role
}

function relationLabel(status: string) {
  const map: Record<string, string> = { suggested: '待确认', accepted: '已采纳', rejected: '已拒绝', replaced: '已替换' }
  return map[status] ?? status
}

/**
 * 未提交的输入按卡片存 sessionStorage。聚焦与普通卡片视图共用同一个 key，
 * 这样「退出聚焦」「返回看板」「刷新页面」都不会把已经写下的原话弄丢。
 */
function draftKey(cardId: string) {
  return `pms:draft:${cardId}`
}
function readDraft(cardId: string): string {
  try { return sessionStorage.getItem(draftKey(cardId)) ?? '' } catch { return '' }
}
function writeDraft(cardId: string, text: string) {
  try {
    if (text) sessionStorage.setItem(draftKey(cardId), text)
    else sessionStorage.removeItem(draftKey(cardId))
  } catch { /* 隐私模式下不可写，退化为仅内存草稿 */ }
}

/** 每次推进生成一次幂等键，重试沿用同一个，避免网络重发导致重复追加原话。 */
let opCounter = 0
function clientOpId(prefix: string) {
  opCounter += 1
  return `${prefix}:${Date.now().toString(36)}:${opCounter}`
}

/** toast 不再绑定删除操作；任何操作都能给出一句反馈和可选的撤销入口。 */
interface Notice {
  title: string
  undo?: { label: string, run: () => void }
  /** 只在标为成熟时盖的骑缝章，不常驻界面。 */
  seal?: string
}

export const inject = ['slots', 'layout']

/** 由 scripts/build.mjs 注入；dev 下 tsc 也需要一个声明。 */
declare const __PMS_BUILD_STAMP__: string | undefined

export function apply(ctx: ClientCtx) {
  const style = document.createElement('style')
  style.dataset.pms = 'personal-media-studio'
  style.dataset.pmsBuild = typeof __PMS_BUILD_STAMP__ === 'undefined' ? 'dev' : __PMS_BUILD_STAMP__
  // 顺序固定：令牌 → 组件 → 布局。改顺序会破坏层叠优先级。
  style.textContent = `${tokens}\n${components}\n${css}`
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
  const openStage = (stage: StageId) => {
    ctx.layout.selectPanel(PANELS[stage])
  }
  const stages: StageId[] = ['topics', 'drafts', 'render', 'inspiration']
  for (const stage of stages) {
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANELS[stage] }, () => <StudioApp stage={stage} openStage={openStage} />))
  }
  // 侧栏只留一个入口；阶段切换只在顶栏出现一次。
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANELS.topics,
    order: 8,
    label: () => '媒体工作室',
  }, (props: { size?: number }) => <StudioIcon size={props.size} />))
  const syncHash = () => {
    if (!location.hash.startsWith('#pms/')) return
    openStage(readRoute('topics').stage)
  }
  window.addEventListener('hashchange', syncHash)
  ctx.effect(() => () => window.removeEventListener('hashchange', syncHash))
  if (location.hash.startsWith('#pms/')) {
    let tries = 0
    const boot = () => {
      try { syncHash() } catch { if (tries++ < 20) window.setTimeout(boot, 250) }
    }
    window.setTimeout(boot, 0)
  }
}

function StudioIcon({ size = 22 }: { size?: number, active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="7" width="16" height="20" rx="2.5" fill="currentColor" opacity="0.28" />
      <rect x="10" y="4" width="16" height="20" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14 10h8M14 14h8M14 18h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function StudioApp({ stage, openStage }: { stage: StageId, openStage: (stage: StageId) => void }) {
  const [boot, setBoot] = useState<{ engine: { mode: string, reason: string }, libraryCount: number, cards: CardRow[], pool?: { total: number, topics: PoolTopic[] }, stages?: StageBook, inspiration?: InspirationView } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [cardId, setCardId] = useState<string | null>(() => {
    const route = readRoute(stage)
    return route.stage === stage ? route.cardId : null
  })
  const [toast, setToast] = useState<(Notice & { id: string }) | null>(null)
  const [topicView, setTopicView] = useState<'board' | 'pool'>('board')
  // 聚焦模式的起点由「从哪张卡进来」决定；哈希直达时也在这里恢复。
  const [focusStart, setFocusStart] = useState<string | null>(() => stage === 'topics' ? focusRouteId() : null)

  async function refresh() {
    const data = await rpc<NonNullable<typeof boot>>('bootstrap')
    setBoot(data)
    return data
  }

  function notify(notice: Notice) {
    setToast({ ...notice, id: clientOpId('toast') })
  }

  /** 聚焦推进后只等轻量 ID 列表；阶段计数另走一次全量刷新，不堵住换卡。 */
  async function reloadBoard(): Promise<string[]> {
    const ids = rpc<string[]>('listBoardIds')
    void refresh().catch(() => undefined)
    return ids
  }

  useEffect(() => {
    if (!toast) return
    const duration = toast.undo ? 6000 : 3500
    const timer = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), duration)
    return () => window.clearTimeout(timer)
  }, [toast])

  function enterFocus(id: string) {
    setCardId(null)
    const hash = `#pms/topics/focus/${id}`
    if (location.hash !== hash) location.hash = hash
    setFocusStart(id)
  }

  function leaveFocus(view?: 'board' | 'pool') {
    setFocusStart(null)
    if (view) setTopicView(view)
    if (focusRouteId()) location.hash = '#pms/topics'
    void refresh()
  }

  function go(nextStage: StageId, nextCard: string | null) {
    const hash = nextCard ? `#pms/${nextStage}/${nextCard}` : `#pms/${nextStage}`
    if (location.hash !== hash) location.hash = hash
    else openStage(nextStage)
    if (nextStage === stage) setCardId(nextCard)
    // 点阶段导航的「选题」就是回看板；从卡片进入聚焦时由 enterFocus 随后再设置起点。
    if (nextStage !== 'topics' || nextCard === null) setFocusStart(null)
  }

  useEffect(() => {
    if (!location.hash.startsWith('#pms/')) {
      location.hash = `#pms/${stage}`
      return
    }
    const focused = focusRouteId()
    if (focused) {
      setFocusStart(focused)
      setCardId(null)
      return
    }
    const route = readRoute(stage)
    if (route.stage !== stage) {
      location.hash = `#pms/${stage}`
      return
    }
    // 选题只有一个卡片入口：旧链接 #pms/topics/<id> 直接转到聚焦工作台。
    if (stage === 'topics' && route.cardId) {
      location.hash = `#pms/topics/focus/${route.cardId}`
      return
    }
    setCardId(route.cardId)
  }, [stage])

  useEffect(() => {
    const onHash = () => {
      const focused = focusRouteId()
      if (focused) {
        setFocusStart(focused)
        setCardId(null)
        return
      }
      const route = readRoute(stage)
      if (route.stage === stage) {
        if (stage === 'topics' && route.cardId) {
          location.hash = `#pms/topics/focus/${route.cardId}`
          return
        }
        setCardId(route.cardId)
      }
      setFocusStart(null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [stage])

  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  const counts = boot?.stages?.counts ?? { topics: boot?.cards.length ?? 0, drafts: 0, render: 0, inspiration: 0 }
  const topicCards = (boot?.stages?.topics ?? []).map(row => {
    const card = boot?.cards.find(item => item.id === row.id)
    return { ...(card ?? { id: row.id, title: row.title, status: row.status, maturity: row.maturity, source: row.source, updated_at: row.updatedAt }), updatedAt: row.updatedAt }
  })

  return (
    <div className="pms-root" data-testid="studio-root" data-stage={stage}>
      {/* 聚焦是一屏只做一件事：藏掉阶段导航，只留聚焦子栏。 */}
      {!focusStart && (
      <header className="pms-toolbar">
        <span className="pms-toolbar__brand">
          <span className="pms-toolbar__mark" aria-hidden="true">P</span>
          <span>个人媒体工作室</span>
        </span>
        <nav className="pms-segmented" data-testid="stage-nav" aria-label="工作室阶段">
          {(['topics', 'drafts', 'render', 'inspiration'] as const).map(item => (
            <button
              key={item}
              type="button"
              className="pms-segment"
              aria-selected={item === stage}
              aria-current={item === stage ? 'page' : undefined}
              data-testid={`stage-${item}`}
              onClick={() => go(item, null)}
            >
              {STAGE_LABEL[item]}
              <span className="pms-segment__count" data-testid="stage-count">{counts[item]}</span>
            </button>
          ))}
        </nav>
        <span className="pms-spacer" />
        <div className="pms-toolbar__actions">
          {boot && (
            <span className={boot.engine.mode === 'llm' ? 'pms-badge pms-badge--accent' : 'pms-badge pms-badge--warn'} data-testid="engine-badge" title={boot.engine.reason}>
              {boot.engine.mode === 'llm' ? '模型已连接' : '本地预览引擎'}
            </span>
          )}
          {cardId && <button className="pms-btn pms-btn--sm" onClick={() => { go(stage, null); void refresh() }}>{stage === 'topics' ? '返回选题' : '返回列表'}</button>}
          {stage === 'topics' && !cardId && <NewCard onCreated={id => { void refresh().then(() => enterFocus(id)) }} />}
        </div>
      </header>
      )}
      <div className="pms-body">
        {loading && <StudioSkeleton />}
        {error && (
          <div className="pms-view pms-view--padded">
            <div className="pms-error" data-testid="error">{error}</div>
          </div>
        )}
        {!loading && !error && stage === 'topics' && !cardId && !focusStart && boot && (
          <Home
            cards={topicCards}
            libraryCount={boot.libraryCount}
            pool={boot.pool ?? { total: 0, topics: [] }}
            view={topicView}
            onView={setTopicView}
            onOpen={id => enterFocus(id)}
            onChanged={() => { void refresh() }}
          />
        )}
        {!loading && !error && stage === 'topics' && !cardId && focusStart && boot && (
          <FocusWorkbench
            key={focusStart}
            cards={topicCards}
            startId={focusStart}
            onExit={() => leaveFocus()}
            onBoard={() => leaveFocus('board')}
            onPool={() => leaveFocus('pool')}
            onChanged={reloadBoard}
            onNotice={notify}
          />
        )}
        {!loading && !error && stage === 'drafts' && !cardId && (
          <StageList testId="draft-center" rowTestId="draft-row" empty="还没有成熟的选题。在选题里把一张卡标为成熟后，它会出现在这里。" rows={boot?.stages?.drafts ?? []} onOpen={id => go('drafts', id)} />
        )}
        {!loading && !error && stage === 'render' && !cardId && (
          <StageList testId="render-center" rowTestId="render-row" empty="还没有定稿。生产改稿里确认文字之后，稿件会送到这里渲染。" rows={boot?.stages?.render ?? []} onOpen={id => go('render', id)} />
        )}
        {!loading && !error && stage === 'inspiration' && boot && (
          <InspirationStage
            data={boot.inspiration ?? { sources: [], items: [], candidates: [], counts: { pending: 0, approved: 0, rejected: 0 } }}
            onChanged={async () => { await refresh() }}
            onNotice={notify}
            onTopics={() => go('topics', null)}
          />
        )}
        {stage === 'drafts' && cardId && (
          <ArticleStudio
            cardId={cardId}
            onBack={() => {
              notify({ title: '已退回选题看板' })
              go('topics', null)
              void refresh()
            }}
            onRender={() => { go('render', cardId); void refresh() }}
          />
        )}
        {stage === 'render' && cardId && (
          <XhsStage cardId={cardId} onReturn={() => { go('drafts', cardId); void refresh() }} />
        )}
      </div>
      {toast && (
        <div className="pms-toast" role="status" data-testid="undo-toast">
          {toast.seal && <span className="pms-toast__seal" aria-hidden="true">{toast.seal}</span>}
          <span>{toast.title}</span>
          {toast.undo && (
            <button
              className="pms-btn pms-btn--sm pms-btn--ghost"
              type="button"
              onClick={() => { const undo = toast.undo; setToast(null); undo?.run() }}
            >{toast.undo.label}</button>
          )}
        </div>
      )}
    </div>
  )
}

/** 加载态用骨架而非一行文字：保留版式轮廓，避免内容区高度塌陷后跳动。 */
function StudioSkeleton() {
  return (
    <div className="pms-view pms-view--padded" data-testid="loading" role="status" aria-label="正在打开这一阶段">
      <div className="pms-board">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="pms-skeleton-card" aria-hidden="true">
            <div className="pms-skeleton" style={{ height: 18, width: `${40 + (i % 3) * 14}%` }} />
            <div className="pms-skeleton" style={{ height: 13, width: '92%' }} />
            <div className="pms-skeleton" style={{ height: 13, width: '78%' }} />
            <div className="pms-skeleton" style={{ height: 13, width: '52%', marginTop: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StageList({ rows, empty, testId, rowTestId, onOpen }: { rows: StageRow[], empty: string, testId: string, rowTestId: string, onOpen: (id: string) => void }) {
  const heading = testId === 'render-center' ? '排好版，再看一遍' : '接下来写哪一篇'
  const kicker = testId === 'render-center' ? '渲染队列' : '草稿'
  return (
    <div className="pms-view pms-paper-screens" data-testid={testId}>
      <div className="pms-scroll">
        <div className="pms-paper-page">
          <header className="pms-paper-pagehead">
            <p className="pms-paper-kicker">{kicker} · {rows.length}</p>
            <h1>{heading}</h1>
          </header>
          {rows.length === 0 && <div className="pms-paper-empty">{empty}</div>}
          <div className="pms-paper-list">
            {rows.map((row, index) => (
              <button key={row.id} className="pms-paper-topic" data-testid={rowTestId} onClick={() => onOpen(row.id)}>
                <time dateTime={row.updatedAt}>{formatWhen(row.updatedAt).slice(5, 10)}</time>
                <span className="pms-paper-topic__body">
                  <span className="pms-paper-topic__title">{row.title}</span>
                  <span className="pms-paper-topic__meta">
                    {String(index + 1).padStart(2, '0')} · {statusLabel(row.projectStatus || row.status)} · {maturityLabel(row.maturity)}
                  </span>
                </span>
                <span className="pms-paper-topic__arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function InspirationStage({ data, onChanged, onNotice, onTopics }: {
  data: InspirationView
  onChanged: () => Promise<void> | void
  onNotice: (notice: Notice) => void
  onTopics: () => void
}) {
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryHits, setLibraryHits] = useState<AssetHit[]>([])
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const needle = query.trim().toLowerCase()
  const rows = data.candidates
    .filter(candidate => candidate.status === tab)
    .filter(candidate => !needle || [candidate.angle, candidate.why, candidate.itemBody, candidate.sourceName].some(value => value.toLowerCase().includes(needle)))

  async function capture() {
    if (!body.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await rpc('captureInspiration', { body, url })
      setBody('')
      setUrl('')
      setTab('pending')
      await onChanged()
      onNotice({ title: '收进来了。等你判断，不替你通过。' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function searchLibrary() {
    if (libraryBusy) return
    setLibraryBusy(true)
    setError('')
    try {
      setLibraryHits(await rpc<AssetHit[]>('searchInspirationAssets', { query: libraryQuery }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLibraryBusy(false)
    }
  }

  async function takeLibrary(assetId: string) {
    if (libraryBusy) return
    setLibraryBusy(true)
    setError('')
    try {
      await rpc('captureLibraryInspiration', { assetId })
      setTab('pending')
      await onChanged()
      onNotice({ title: '素材收进来了。它还是待确认，不替你通过。' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLibraryBusy(false)
    }
  }

  async function importNotes(file: File) {
    if (importing) return
    setImporting(true)
    setError('')
    try {
      const result = await rpc<{ imported: number, skipped: number, total: number }>('importQianfanNotesText', {
        text: await file.text(),
        fileName: file.name,
      })
      await onChanged()
      onNotice({ title: `导入了 ${result.imported} 条笔记，跳过 ${result.skipped} 条重复或空行。` })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  async function decide(candidate: InspirationCandidate, decision: 'approved' | 'rejected') {
    setBusy(true)
    setError('')
    try {
      await rpc('decideInspiration', { candidateId: candidate.id, decision })
      await onChanged()
      onNotice({ title: decision === 'approved' ? '已进入选题。它现在是一张待写的卡。' : '已略过。没有进入选题。' })
      if (decision === 'approved') setTab('approved')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pms-view pms-paper-screens" data-testid="inspiration-center">
      <div className="pms-scroll">
        <div className="pms-paper-page">
          <header className="pms-paper-pagehead">
            <p className="pms-paper-kicker">灵感 · {data.counts.pending} 条待判断</p>
            <h1>先把东西丢进来</h1>
            <p className="pms-paper-lede">
              一句原话、一个链接、一段观察都可以。系统只收下，不替你改写，也不替你判断；你点了通过，它才进选题。
            </p>
          </header>

          <div className="pms-source-strip" aria-label="来源状态">
            {data.sources.map(source => (
              <span key={source.id} className="pms-source-chip" data-status={source.status} title={source.detail}>
                <span className="pms-source-chip__dot" aria-hidden="true" />
                {source.name} · {source.status === 'connected' ? '已接' : '未接'}
              </span>
            ))}
          </div>

          <div className="pms-inspiration-compose">
            <textarea
              value={body}
              onChange={event => setBody(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void capture()
                }
              }}
              rows={3}
              placeholder="贴一句你真正想说的话，或一个链接、一段观察……"
              aria-label="收进灵感"
            />
            <div className="pms-inspiration-compose__foot">
              <input value={url} onChange={event => setUrl(event.target.value)} placeholder="来源链接（可选）" aria-label="来源链接" />
              <span className="pms-inspiration-compose__hint">⌘↵ 收下</span>
              <button className="pms-btn pms-btn--primary pms-btn--sm" type="button" disabled={!body.trim() || busy} onClick={() => void capture()}>
                {busy ? '收下…' : '收下'}
              </button>
            </div>
          </div>
          {error && <div className="pms-error">{error}</div>}
          <p className="pms-inspiration-note">自动提取还没开。现在只收下你主动丢进来的东西，也可以让 DSH 助手用 <code>media_propose_inspiration</code> 提议；素材库是只读索引，千帆互动和交易还没接，状态不装成“已同步”。</p>

          <details className="pms-library-pick">
            <summary>从素材库挑一条 <span>只读索引</span></summary>
            <div className="pms-library-pick__body">
              <div className="pms-library-pick__search">
                <input
                  value={libraryQuery}
                  onChange={event => setLibraryQuery(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void searchLibrary()
                    }
                  }}
                  placeholder="搜素材标题、正文或路径，留空看最近"
                  aria-label="搜索素材库"
                />
                <button className="pms-btn pms-btn--sm" type="button" disabled={libraryBusy} onClick={() => void searchLibrary()}>
                  {libraryBusy ? '找…' : '找'}
                </button>
              </div>
              {libraryHits.length > 0 ? (
                <div className="pms-library-pick__hits">
                  {libraryHits.map(hit => (
                    <div key={hit.assetId} className="pms-library-pick__hit">
                      <div className="pms-library-pick__text">
                        <strong>{hit.title || '未命名素材'}</strong>
                        <span title={hit.sourcePath}>{hit.sourcePath}</span>
                      </div>
                      <button className="pms-btn pms-btn--sm pms-btn--ghost" type="button" disabled={libraryBusy} onClick={() => void takeLibrary(hit.assetId)}>
                        收下
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pms-library-pick__empty">只读取索引，不复制原文件；收下后仍是待确认。</p>
              )}
            </div>
          </details>

          <details className="pms-library-pick pms-qianfan-import">
            <summary>导入千帆笔记数据 <span>CSV · 只作证据</span></summary>
            <div className="pms-library-pick__body">
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={importing}
                aria-label="选择千帆笔记 CSV"
                onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void importNotes(file)
                  event.target.value = ''
                }}
              />
              <p className="pms-library-pick__empty">按标题和发布时间去重；指标只作为证据，不建卡，也不替你判断。</p>
            </div>
          </details>

          <div className="pms-inspiration-search">
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜一条灵感、一句原话或来源"
              aria-label="搜索灵感"
            />
            {query && <button type="button" className="pms-btn pms-btn--sm pms-btn--ghost" onClick={() => setQuery('')}>清空</button>}
          </div>

          <div className="pms-inspiration-tabs" role="tablist" aria-label="灵感状态">
            {(['pending', 'approved', 'rejected'] as const).map(item => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className="pms-inspiration-tab"
                onClick={() => setTab(item)}
              >
                {item === 'pending' ? '待确认' : item === 'approved' ? '已通过' : '已略过'}
                <span>{data.counts[item]}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="pms-paper-empty">
              <strong>{needle ? '没有匹配的灵感' : tab === 'pending' ? '还没有待判断的灵感' : tab === 'approved' ? '还没有通过的灵感' : '还没有略过的灵感'}</strong>
              <span>{needle ? '换一个词，或清空搜索。' : tab === 'pending' ? '把一句原话丢进上面的框里，先收下。' : '你做的判断会留在这里，之后可以回看。'}</span>
            </div>
          ) : (
            <div className="pms-inspiration-list">
              {rows.map(candidate => (
                <article key={candidate.id} className="pms-inspiration-row" data-testid="inspiration-row">
                  <div className="pms-inspiration-row__main">
                    <h2 className="pms-inspiration-row__angle">{candidate.angle}</h2>
                    <p className="pms-inspiration-row__why">{candidate.why}</p>
                    <p className="pms-inspiration-row__meta">
                      {candidate.sourceName} · {formatWhen(candidate.createdAt).slice(5, 16)} · {candidate.itemProvenance}
                    </p>
                    {candidate.itemUrl && <a className="pms-inspiration-row__link" href={candidate.itemUrl} target="_blank" rel="noreferrer">看来源</a>}
                  </div>
                  <div className="pms-inspiration-row__actions">
                    {candidate.status === 'pending' && (
                      <>
                        <button className="pms-btn pms-btn--sm pms-btn--primary" type="button" disabled={busy} onClick={() => void decide(candidate, 'approved')}>通过，进选题</button>
                        <button className="pms-btn pms-btn--sm pms-btn--ghost" type="button" disabled={busy} onClick={() => void decide(candidate, 'rejected')}>略过</button>
                      </>
                    )}
                    {candidate.status === 'approved' && (
                      <>
                        <span className="pms-inspiration-row__done">已进选题</span>
                        <button className="pms-btn pms-btn--sm pms-btn--ghost" type="button" onClick={onTopics}>去选题</button>
                      </>
                    )}
                    {candidate.status === 'rejected' && <span className="pms-inspiration-row__done">已略过</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatWhen(value: string) {
  return value.replace('T', ' ').slice(0, 16)
}

function formatClock(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatWhen(value).slice(11, 16)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

interface ArticleDoc {
  draftId: string
  title: string
  markdown: string
  suggestions: Array<{ id: string, text: string, status: string }>
  versions: Array<{ id: string, label: string, created_at: string }>
}

function ArticleStudio({ cardId, onBack, onRender }: { cardId: string, onBack: () => void, onRender: () => void }) {
  const [doc, setDoc] = useState<ArticleDoc | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [saved, setSaved] = useState('正在生成文稿…')
  const [error, setError] = useState('')
  // 写作与阅读互斥；大纲/建议/版本放进侧栏切页，不再用浮层遮住正文。
  const [view, setView] = useState<'write' | 'read'>('write')
  const [panel, setPanel] = useState<'outline' | 'suggestions' | 'versions'>('outline')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void rpc<ArticleDoc>('openArticle', { cardId }).then(value => {
      setDoc(value)
      setMarkdown(value.markdown)
      setSaved('已生成，改字会自动保存')
    }).catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [cardId])
  useEffect(() => {
    if (!doc || markdown === doc.markdown) return
    const handle = window.setTimeout(() => {
      setSaved('保存中…')
      void rpc('saveArticle', { cardId, markdown }).then(() => setSaved('已自动保存')).catch(err => setSaved(err instanceof Error ? err.message : '保存失败'))
    }, 700)
    return () => window.clearTimeout(handle)
  }, [markdown, doc, cardId])
  const outline = markdown.split('\n').filter(line => /^#{1,3}\s/.test(line))
  if (error) return <div className="pms-error">{error}</div>
  if (!doc) return <div className="pms-empty">正在把你的原话收成一篇稿…</div>
  return (
    <div className="pms-view" data-testid="article-editor">
      <div className="pms-toolbar pms-toolbar--sub">
        <button className="pms-btn pms-btn--sm pms-btn--ghost" onClick={() => { void rpc('returnToTopics', { cardId }).then(onBack) }}>退回选题</button>
        <span className="pms-toolbar__context" title={doc.title}>{doc.title}</span>
        <div className="pms-segmented" role="tablist" aria-label="编辑视图">
          <button type="button" role="tab" className="pms-segment" aria-selected={view === 'write'} onClick={() => setView('write')}>写作</button>
          <button type="button" role="tab" className="pms-segment" aria-selected={view === 'read'} onClick={() => setView('read')}>阅读</button>
        </div>
        <span className="pms-meta" data-testid="save-state">{saved}</span>
        <button className="pms-btn pms-btn--sm" onClick={() => void rpc('snapshotArticle', { cardId, label: '手动版本' }).then(result => setDoc(current => current ? { ...current, versions: (result as { versions: ArticleDoc['versions'] }).versions } : current))}>保存版本</button>
        <button className="pms-btn pms-btn--sm pms-btn--primary" data-testid="confirm-text" disabled={busy} onClick={() => {
          setBusy(true)
          void rpc('saveArticle', { cardId, markdown }).then(() => rpc('confirmForRender', { cardId })).then(onRender).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false))
        }}>定稿，送去渲染</button>
      </div>

      <div className="pms-workarea">
        {view === 'write' ? (
          <div className="pms-editor">
            <textarea data-testid="article-md" value={markdown} spellCheck={false} onChange={event => setMarkdown(event.target.value)} />
          </div>
        ) : (
          <div className="pms-reader">
            <article className="pms-reader__body" data-testid="article-read">{markdown}</article>
          </div>
        )}

        <aside className="pms-drawer" data-testid="suggestion-drawer">
          <div className="pms-segmented" role="tablist" aria-label="侧栏内容">
            <button type="button" role="tab" className="pms-segment" aria-selected={panel === 'outline'} onClick={() => setPanel('outline')}>大纲</button>
            <button type="button" role="tab" className="pms-segment" aria-selected={panel === 'suggestions'} onClick={() => setPanel('suggestions')}>
              建议<span className="pms-segment__count">{doc.suggestions.length}</span>
            </button>
            <button type="button" role="tab" className="pms-segment" aria-selected={panel === 'versions'} onClick={() => setPanel('versions')}>
              版本<span className="pms-segment__count">{doc.versions.length}</span>
            </button>
          </div>

          {panel === 'outline' && (
            <div className="pms-stack">
              <p className="pms-panel__title">小标题结构</p>
              {outline.length === 0
                ? <p className="pms-note">这篇还没有小标题。在正文里用 ## 起一行就会出现在这里。</p>
                : <ol className="pms-outline">{outline.map(line => <li key={line}>{line.replace(/^#+\s/, '')}</li>)}</ol>}
            </div>
          )}

          {panel === 'suggestions' && (
            <div className="pms-stack">
              <p className="pms-panel__title">建议</p>
              <p className="pms-note">建议不会改你的句子。要收进正文，自己贴进去。</p>
              {doc.suggestions.length === 0 && <p className="pms-note">还没有新的建议。</p>}
              {doc.suggestions.map(item => <div key={item.id} className="pms-suggestion">{item.text}</div>)}
            </div>
          )}

          {panel === 'versions' && (
            <div className="pms-stack">
              <p className="pms-panel__title">历史版本</p>
              {doc.versions.length === 0 && <p className="pms-note">还没有保存过版本。</p>}
              <div className="pms-version-list">
                {doc.versions.slice(0, 12).map(row => (
                  <button key={row.id} className="pms-btn pms-btn--sm" onClick={() => void rpc<ArticleDoc>('restoreVersion', { versionId: row.id }).then(() => rpc<ArticleDoc>('openArticle', { cardId })).then(value => { setDoc(value); setMarkdown(value.markdown) })}>{row.label}</button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {error && <div className="pms-error" style={{ margin: '0 var(--pms-inset-page) var(--pms-space-4)' }}>{error}</div>}
    </div>
  )
}

function XhsStage({ cardId, onReturn }: { cardId: string, onReturn: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const pending = useRef<Record<string, string> | null>(null)
  const [picker, setPicker] = useState<'screenshot' | 'product' | null>(null)
  const [assets, setAssets] = useState<AssetHit[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const post = (message: object) => frame.current?.contentWindow?.postMessage(message, '*')
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string, state?: Record<string, string>, kind?: 'screenshot' | 'product', index?: number }
      if (!data?.type) return
      if (data.type === 'pms:ready' && pending.current) post({ type: 'pms:load', state: pending.current })
      if (data.type === 'pms:change' && data.state) {
        void rpc('saveRenderState', { cardId, state: data.state }).catch(err => setError(err instanceof Error ? err.message : String(err)))
      }
      if (data.type === 'pms:back') {
        void rpc('returnToDrafts', { cardId }).then(onReturn)
      }
      if (data.type === 'pms:request-asset' && (data.kind === 'screenshot' || data.kind === 'product')) {
        setPicker(data.kind)
        void rpc<AssetHit[]>('searchAssets', { query: '' }).then(setAssets)
      }
      if (data.type === 'pms:export' || data.type === 'pms:export-page') {
        void rpc<{ dir: string, manifest: { files: string[] } }>('exportProject', { cardId }).then(result => {
          post({ type: 'pms:exported', href: '#', name: '已写入导出目录' })
          setError(`成片已写入 ${result.dir}`)
        }).catch(() => post({ type: 'pms:export-fallback', index: data.index }))
      }
    }
    window.addEventListener('message', onMessage)
    void rpc<{ state: Record<string, string> }>('renderDocument', { cardId }).then(doc => {
      pending.current = doc.state
      post({ type: 'pms:load', state: doc.state })
    }).catch(err => setError(err instanceof Error ? err.message : String(err)))
    return () => window.removeEventListener('message', onMessage)
  }, [cardId, onReturn])
  return (
    <div className="pms-xhs" data-testid="workbench">
      <div className="pms-xhs__frame">
        <iframe ref={frame} title="小红书长文出图" data-testid="xhs-editor" src="/api/personal-media-studio/editor?embed=1" />
        {error && <div className="pms-xhs__status">{error}</div>}
      </div>
      {picker && (
        <aside className="pms-drawer" data-testid="asset-picker">
          <div className="pms-drawer__head">
            <p className="pms-panel__title">{picker === 'product' ? '插入商品页' : '插入截图页'}</p>
            <button className="pms-iconbtn pms-iconbtn--sm" type="button" aria-label="关闭素材面板" onClick={() => setPicker(null)}>✕</button>
          </div>
          <form
            className="pms-row"
            onSubmit={event => {
              event.preventDefault()
              void rpc<AssetHit[]>('searchAssets', { query }).then(setAssets)
            }}
          >
            <input className="pms-input" aria-label="搜索素材" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文件名" />
            <button className="pms-btn pms-btn--sm" type="submit">搜索</button>
          </form>
          <div className="pms-stack">
            {assets.length === 0 && <p className="pms-note">还没有搜到素材。试试文件名里的关键词。</p>}
            {assets.map(asset => (
              <button
                key={asset.assetId}
                className="pms-btn pms-btn--sm"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => {
                  const src = `/api/personal-media-studio/asset?id=${asset.assetId}`
                  const markdown = picker === 'product'
                    ? `\`\`\`product\nname: ${asset.title}\ntagline: 待确认\npoints:\n- 待确认\nprice: 待确认\nhow: 待确认\nimage: ${src}\ncaption: ${asset.title}\n\`\`\``
                    : `\`\`\`screenshot\nsrc: ${src}\ncaption: ${asset.title}\n\`\`\``
                  frame.current?.contentWindow?.postMessage({ type: 'pms:insert', markdown }, '*')
                  setPicker(null)
                }}
              >{asset.title}</button>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}

function NewCard({ onCreated }: { onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(false)
  if (!open) return <button className="pms-btn pms-btn--sm" data-testid="new-card" onClick={() => setOpen(true)}>新建选题</button>
  return (
    <form className="pms-row" onSubmit={event => {
      event.preventDefault()
      void rpc<{ card: { id: string } }>('createCard', { title }).then(result => onCreated(result.card.id))
    }}>
      <input aria-label="选题标题" value={title} onChange={event => setTitle(event.target.value)} placeholder="这张卡想讲什么" />
      <button className="pms-btn pms-btn--sm pms-btn--primary" type="submit">创建</button>
    </form>
  )
}

type TopicView = 'board' | 'pool'

/** tab 与 tabpanel 用同一组 id 互相指认，读屏器才知道当前选中了哪一页。 */
function topicTabId(view: TopicView) {
  return `pms-topic-tab-${view}`
}

/** 选题页两个数据视图共用一组分段控件；点卡片或“放到看板上”都进入同一张工作台。 */
function TopicTabs({ view, boardCount, poolCount, onBoard, onPool }: {
  view: TopicView,
  boardCount: number,
  poolCount: number,
  onBoard: () => void,
  onPool: () => void,
}) {
  return (
    <div className="pms-segmented" role="tablist" aria-label="选题视图">
      <button type="button" role="tab" id={topicTabId('board')} aria-controls="pms-topic-panel" className="pms-segment" aria-selected={view === 'board'} onClick={onBoard}>
        看板<span className="pms-segment__count">{boardCount}</span>
      </button>
      <button type="button" role="tab" id={topicTabId('pool')} aria-controls="pms-topic-panel" className="pms-segment" aria-selected={view === 'pool'} onClick={onPool}>
        问答池<span className="pms-segment__count">{poolCount}</span>
      </button>
    </div>
  )
}

function Home({ cards, libraryCount, pool, view, onView, onOpen, onChanged }: {
  cards: CardRow[],
  libraryCount: number,
  pool: { total: number, topics: PoolTopic[] },
  view: 'board' | 'pool',
  onView: (view: 'board' | 'pool') => void,
  onOpen: (id: string) => void,
  onChanged: () => void,
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState(pool.topics)
  const [total, setTotal] = useState(pool.total)
  const [poolError, setPoolError] = useState('')

  function searchPool(nextQuery: string) {
    void rpc<{ total: number, topics: PoolTopic[] }>('searchPool', { query: nextQuery }).then(result => {
      setHits(result.topics)
      setTotal(nextQuery.trim() ? result.total : pool.total)
      setPoolError('')
    }).catch(err => setPoolError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="pms-view pms-paper-screens" data-testid="topic-center">
      <div className="pms-toolbar pms-toolbar--sub pms-paper-subbar">
        <TopicTabs
          view={view}
          boardCount={cards.length}
          poolCount={total}
          onBoard={() => onView('board')}
          onPool={() => onView('pool')}
        />
        <span className="pms-toolbar__context">
          本地素材 {libraryCount} 条 · {view === 'board' ? '还没写、但一直有人问的方向' : '同类问题并成一个方向'}
        </span>
        <span className="pms-spacer" />
        {view === 'pool' && (
          <form
            className="pms-row"
            onSubmit={event => {
              event.preventDefault()
              searchPool(query)
            }}
          >
            <input
              className="pms-input pms-pool-search"
              aria-label="搜索问答选题池"
              data-testid="pool-search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜同学原话，或一个方向"
            />
            <button className="pms-btn pms-btn--sm" type="submit">搜索</button>
          </form>
        )}
      </div>

      <div className="pms-scroll" role="tabpanel" id="pms-topic-panel" aria-labelledby={topicTabId(view)}>
        {view === 'board' && (
          <div className="pms-paper-page">
            <header className="pms-paper-pagehead">
              <p className="pms-paper-kicker">选题库 · {cards.length}</p>
              <h1>手上有什么值得写的</h1>
              <p className="pms-paper-lede">从一个具体的问题开始。点开一张卡，先写下你真正想说的那一句。</p>
            </header>
            {cards.length === 0
              ? (
                <div className="pms-paper-empty">
                  <strong>看板上还没有推荐卡</strong>
                  <span>切到问答池挑一个方向，或者右上角新建一张。</span>
                </div>
                )
              : (
                <div className="pms-paper-list">
                  {cards.map((card, index) => (
                    <button key={card.id} className="pms-paper-topic" data-testid="topic-card" onClick={() => onOpen(card.id)}>
                      <time dateTime={card.updatedAt}>{formatWhen(card.updatedAt ?? '').slice(5, 10)}</time>
                      <span className="pms-paper-topic__body">
                        <span className="pms-paper-topic__title">{card.title}</span>
                        <span className="pms-paper-topic__excerpt">{card.latestThesis || '还没有写过。点开就能直接说。'}</span>
                        <span className="pms-paper-topic__meta">
                          {String(index + 1).padStart(2, '0')} · {card.source === 'user' ? '我的' : '推荐'} · {maturityLabel(card.maturity)}
                          {Number(card.ask_count) > 0 ? ` · ${card.ask_count} 人问过` : ''}
                        </span>
                      </span>
                      <span className="pms-paper-topic__arrow" aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
                )}
          </div>
        )}

        {view === 'pool' && (
          <div className="pms-paper-page" data-testid="qa-pool">
            <header className="pms-paper-pagehead">
              <p className="pms-paper-kicker">问答池 · {total}</p>
              <h1>有人一直在问的</h1>
              <p className="pms-paper-lede">同类问题并成一个方向。挑一个，放回看板。</p>
            </header>
            {poolError && <div className="pms-error">{poolError}</div>}
            {hits.length === 0 && <div className="pms-paper-empty">选题池里没有对得上的方向。</div>}
            <div className="pms-paper-list">
              {hits.map(topic => (
                <article key={topic.id} className="pms-paper-topic pms-paper-topic--static" data-testid="pool-topic">
                  <span className="pms-paper-topic__body">
                    <span className="pms-paper-topic__title">{topic.title}</span>
                    <span className="pms-paper-topic__excerpt">{topic.summary}</span>
                    <span className="pms-paper-topic__meta">{topic.askCount} 人问过</span>
                  </span>
                  <button className="pms-paper-topic__action" type="button" onClick={() => {
                    void rpc<{ card: { id: string } }>('promotePool', { topicId: topic.id }).then(result => {
                      onChanged()
                      onOpen(result.card.id)
                    }).catch(err => setPoolError(err instanceof Error ? err.message : String(err)))
                  }}>放到看板上</button>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 操作确认弹窗。打开时把其余界面设为 inert，焦点锁在弹窗内，
 * Esc 取消并把焦点还给触发按钮——避免「误点成熟 / 删除」的不可逆感。
 */
function FocusConfirm({ title, description, confirmLabel, tone = 'primary', onCancel, onConfirm }: {
  title: string,
  description: string,
  confirmLabel: string,
  tone?: 'primary' | 'danger',
  onCancel: () => void,
  onConfirm: () => void,
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = dialogRef.current?.closest('.pms-focus, .pms-view')
    const siblings = root ? Array.from(root.children).filter(node => node !== dialogRef.current?.parentElement) : []
    siblings.forEach(node => node.setAttribute('inert', ''))
    cancelRef.current?.focus()
    return () => {
      siblings.forEach(node => node.removeAttribute('inert'))
      previous?.focus()
    }
  }, [])
  return (
    <div className="pms-confirm" data-testid="focus-confirm">
      <div
        ref={dialogRef}
        className="pms-confirm__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pms-confirm-title"
        aria-describedby="pms-confirm-desc"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key !== 'Tab') return
          const focusables = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
          if (focusables.length === 0) return
          const first = focusables[0]
          const last = focusables[focusables.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <h2 id="pms-confirm-title">{title}</h2>
        <p id="pms-confirm-desc">{description}</p>
        <div className="pms-confirm__actions">
          <button ref={cancelRef} className="pms-btn pms-btn--sm pms-btn--ghost" type="button" onClick={onCancel}>取消</button>
          <button className={`pms-btn pms-btn--sm ${tone === 'danger' ? 'pms-btn--danger' : 'pms-btn--primary'}`} type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}


/**
 * 聚焦工作台：一张卡一屏，像和工作室对话一样轮流写。
 * 推进只由「记下，换一张 / 标为成熟」触发；只保存留在当前卡。
 * 队列在进入时按看板顺序拍快照并旋转到起点，一轮内处理过的卡不再出现；走完自动进入下一轮。
 */
function FocusWorkbench({ cards, startId, onExit, onBoard, onPool, onChanged, onNotice }: {
  cards: CardRow[],
  startId: string,
  onExit: () => void,
  onBoard: () => void,
  onPool: () => void,
  onChanged: () => Promise<string[]>,
  onNotice: (notice: Notice) => void,
}) {
  const [state, setState] = useState<FocusQueue>(() => createQueue(cards.map(card => card.id), startId))
  const [finished, setFinished] = useState(false)
  const currentId = finished ? null : state.queue[state.position] ?? null
  const [detail, setDetail] = useState<CardDetail | null>(null)
  const [body, setBody] = useState('')
  const bodyRef = useRef('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmMature, setConfirmMature] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(() => {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('pms-focus-aside')
    return saved === 'open'
  })
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const noteEditRef = useRef<HTMLTextAreaElement>(null)
  const skipNoteBlur = useRef(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const focusAfterAdvance = useRef(false)
  const opRef = useRef<{ key: string, id: string } | null>(null)
  const detailStamp = useRef(0)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pms-focus-aside')
      if (!saved) {
        const panel = document.querySelector<HTMLElement>('.pms-body')
        if ((panel?.clientWidth ?? window.innerWidth) >= 1000) setAnalysisOpen(true)
      }
      localStorage.setItem('pms-focus-aside', analysisOpen ? 'open' : 'closed')
    } catch { /* 忽略隐私模式下的存储失败 */ }
  }, [analysisOpen])

  function beginEditNote(item: CardDetail['interactions'][number]) {
    skipNoteBlur.current = false
    setEditingNoteId(item.id)
    setNoteDraft(item.body)
    window.requestAnimationFrame(() => {
      const node = noteEditRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(node.value.length, node.value.length)
    })
  }

  async function saveNote() {
    if (skipNoteBlur.current) { skipNoteBlur.current = false; setEditingNoteId(null); return }
    if (!editingNoteId || !currentId || savingNote) return
    const noteId = editingNoteId
    const text = noteDraft.trim()
    if (!text) { setError('原话不能改成空句。'); noteEditRef.current?.focus(); return }
    const original = detail?.interactions.find(item => item.id === noteId)
    if (!original) { setEditingNoteId(null); return }
    if (original.body === text) { setEditingNoteId(null); return }
    setSavingNote(true)
    try {
      const next = await rpc<CardDetail>('editThought', { cardId: currentId, interactionId: noteId, body: text })
      setDetail(next)
      setEditingNoteId(prev => prev === noteId ? null : prev)
      setError('')
      onNotice({ title: '原话已更新' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingNote(false)
    }
  }

  function updateBody(next: string) {
    bodyRef.current = next
    setBody(next)
  }

  function opIdFor(key: string) {
    if (opRef.current?.key !== key) opRef.current = { key, id: clientOpId(key) }
    return opRef.current.id
  }

  /** 刷新页面或退出聚焦时，未提交的输入按卡片留在本地草稿。 */
  useEffect(() => () => { if (currentId) writeDraft(currentId, bodyRef.current) }, [currentId])

  useEffect(() => {
    // 换卡不是清空输入，而是换成这张卡自己的草稿。
    const next = currentId ? readDraft(currentId) : ''
    bodyRef.current = next
    setBody(next)
    setError('')
    setEditingNoteId(null)
    setNoteDraft('')
    if (focusAfterAdvance.current) {
      focusAfterAdvance.current = false
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [currentId])

  // 输入框随内容长高，到 200px 后内部滚动；这是对话式输入框的标准手感。
  useEffect(() => {
    const node = inputRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`
  }, [body, currentId])

  // 新内容进来后贴在对话底部；只在换卡或新增原话时滚动，轮询刷新不抢滚动位置。
  useEffect(() => {
    const node = threadRef.current
    if (!node) return
    window.requestAnimationFrame(() => { node.scrollTop = node.scrollHeight })
  }, [currentId, detail?.interactions.length])

  useEffect(() => {
    if (!currentId) { setDetail(null); return }
    let alive = true
    let timer = 0
    let failures = 0
    const load = async () => {
      if (document.hidden) return
      const stamp = ++detailStamp.current
      try {
        const value = await rpc<CardDetail>('getCard', { cardId: currentId })
        if (!alive || stamp !== detailStamp.current) return
        setDetail(value)
        if (failures > 0) { setLoadError(''); failures = 0 }
      } catch (err) {
        if (!alive || stamp !== detailStamp.current) return
        failures += 1
        setLoadError(failures === 1
          ? (err instanceof Error ? err.message : String(err))
          : `分析暂时读不到，正在重试（第 ${failures} 次）。`)
      } finally {
        if (alive) timer = window.setTimeout(() => { void load() }, failures === 0 ? 1200 : Math.min(1200 * 2 ** failures, 12000))
      }
    }
    void load()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [currentId])

  async function refreshDetail(cardId: string) {
    const stamp = ++detailStamp.current
    const value = await rpc<CardDetail>('getCard', { cardId })
    if (stamp === detailStamp.current) setDetail(value)
  }

  async function act(kind: 'append' | 'shelve' | 'mature') {
    if (!currentId || busy) return
    const done = currentId
    const hasInput = body.trim().length > 0
    if (kind === 'append' && !hasInput) {
      setError('先写一句再保存。')
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    setError('')
    try {
      if (kind === 'append') {
        await rpc('appendThought', { cardId: done, body, attachmentAssetIds: [] })
        writeDraft(done, '')
        bodyRef.current = ''
        setBody('')
        await refreshDetail(done)
        onNotice({ title: '原话已保存' })
      } else {
        if (hasInput) {
          // 原子推进：追加和状态变更同一个事务，clientOpId 让重试保持幂等。
          await rpc('advanceCard', {
            cardId: done,
            body,
            attachmentAssetIds: [],
            action: kind,
            clientOpId: opIdFor(`${done}:${kind}`),
          })
        } else {
          await rpc(kind === 'shelve' ? 'shelve' : 'markMature', { cardId: done })
        }
        writeDraft(done, '')
        bodyRef.current = ''
        setBody('')
        opRef.current = null

        const live = new Set(await onChanged())
        const advanced = advanceQueue(state, live, done)
        if (!advanced) {
          setState(current => ({ ...current, processed: [...new Set([...current.processed, done])] }))
          setFinished(true)
          onNotice({
            title: kind === 'mature' ? '已标为成熟，送去改稿' : '已记下，留在本阶段',
            seal: kind === 'mature' ? '成熟' : undefined,
          })
          return
        }
        setState(advanced.state)
        focusAfterAdvance.current = true
        if (advanced.wrapped) {
          onNotice({ title: `本轮已过完，进入第 ${advanced.state.round} 轮` })
        } else if (kind === 'mature') {
          onNotice({
            title: '已标为成熟，送去改稿',
            seal: '成熟',
            undo: {
              label: '退回选题',
              run: () => { void rpc('returnToTopics', { cardId: done }).then(() => { void onChanged() }) },
            },
          })
        } else {
          onNotice({ title: '已记下，留在本阶段' })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeCard() {
    if (!currentId || busy) return
    const done = currentId
    const title = detail?.card.title ?? '这张卡'
    setBusy(true)
    setError('')
    try {
      await rpc('deleteCard', { cardId: done })
      writeDraft(done, '')
      onNotice({
        title: `已删除「${title}」`,
        undo: { label: '撤销', run: () => { void rpc('restoreCard', { cardId: done }).then(() => { void onChanged() }) } },
      })
      onExit()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const progress = queueProgress(state)
  const percent = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0
  const analysis = detail?.analysis
  const pending = detail?.job?.status === 'queued' || detail?.job?.status === 'running'
  const questions = detail?.suggestions.filter(item => item.kind === 'question') ?? []

  return (
    <div
      className={`pms-paper ${analysisOpen ? 'pms-paper--aside' : ''}`}
      data-testid="focus-mode"
      onKeyDown={event => {
        if (confirmMature || confirmDelete) return
        if (event.key === 'Escape') {
          event.preventDefault()
          if (editingNoteId) { setEditingNoteId(null); return }
          if (analysisOpen) { setAnalysisOpen(false); return }
          onExit()
          return
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          if (editingNoteId) { void saveNote(); return }
          void act('shelve')
        }
      }}
    >
      <div className="pms-sr-only" role="status" aria-live="polite">
        {currentId
          ? `第 ${progress.round} 轮，本轮已处理 ${progress.completed} 张，共 ${progress.total} 张。当前：${detail?.card.title ?? '正在打开'}。`
          : '本轮已过完。'}
      </div>

      <div className="pms-paper__main" role="region" aria-label="聚焦处理">
        <header className="pms-paper-head">
          <div className="pms-paper-head__inner">
            <button
              className="pms-paper-back"
              type="button"
              data-testid="exit-focus"
              title="退出聚焦（Esc）"
              onClick={onExit}
            >← <span>回看板</span></button>
            <div className="pms-paper-head__copy">
              <div className="pms-paper-head__kicker">选题 · 聚焦处理</div>
              <h1 className="pms-paper-head__title" data-testid="focus-title">
                {currentId ? (detail?.card.title ?? '正在打开这张卡…') : '这一轮过完了'}
              </h1>
              <div className="pms-paper-head__meta">
                {currentId && detail && (
                  <>
                    <span>{statusLabel(detail.card.status)}</span>
                    <span>{detail.interactions.length} 条原话</span>
                    {Number(detail.askCount) > 0 && <span>{detail.askCount} 人问过</span>}
                  </>
                )}
                <span
                  className="pms-paper-progress"
                  role="progressbar"
                  aria-label="队列进度"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.completed}
                  aria-valuetext={`本轮已处理 ${progress.completed} 张，共 ${progress.total} 张${progress.round > 1 ? `，第 ${progress.round} 轮` : ''}`}
                >
                  <span className="pms-paper-progress__text">
                    {progress.total > 0
                      ? `${progress.completed} / ${progress.total}${progress.round > 1 ? ` · 第 ${progress.round} 轮` : ''}`
                      : '本轮已过完'}
                  </span>
                  <span className="pms-paper-progress__track"><span className="pms-paper-progress__fill" style={{ width: `${percent}%` }} /></span>
                </span>
              </div>
            </div>
            <div className="pms-paper-head__actions">
              <button
                className={`pms-paper-quiet ${analysisOpen ? 'is-on' : ''}`}
                type="button"
                data-testid="focus-analysis-toggle"
                aria-expanded={analysisOpen}
                title="后台自动整理核心判断、缺口、追问和相关素材；不会改你的原话"
                onClick={() => setAnalysisOpen(open => !open)}
              >批注{analysis ? ` ${analysis.gaps.length + questions.length + analysis.relatedAssets.length}` : ''}{pending && <span className="pms-pending-dot" aria-label="正在分析" />}</button>
              {currentId && (
                <button
                  className="pms-paper-quiet pms-paper-quiet--danger"
                  type="button"
                  data-testid="focus-delete"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >删除</button>
              )}
            </div>
          </div>
        </header>

        <div className="pms-paper-scroll" ref={threadRef}>
          {!currentId ? (
            <div className="pms-paper-finished">
              <p className="pms-paper-finished__mark">这一轮都过完了。</p>
              <p>回看板看看，或者从问答池再放一张上来。</p>
              <div className="pms-paper-finished__actions">
                <button className="pms-paper-btn pms-paper-btn--ink" type="button" onClick={onBoard}>回看板</button>
                <button className="pms-paper-quiet" type="button" onClick={onPool}>去问答池</button>
              </div>
            </div>
          ) : (
            <div className="pms-paper-sheet">
              {detail?.inspiration && <Inspiration key={detail.card.id} data={detail.inspiration} />}
              <div className="pms-paper-notes" data-testid="focus-expressions">
                {detail?.interactions.length ? detail.interactions.map((item, index) => (
                  <article className={`pms-paper-note ${editingNoteId === item.id ? 'is-editing' : ''}`} key={item.id}>
                    <div className="pms-paper-note__rail">
                      <time dateTime={item.created_at}>{formatClock(item.created_at)}</time>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <div className="pms-paper-note__body">
                      {editingNoteId === item.id ? (
                        <textarea
                          ref={noteEditRef}
                          className="pms-paper-note__edit"
                          value={noteDraft}
                          rows={Math.max(2, Math.ceil(noteDraft.length / 34))}
                          aria-label="编辑这条原话"
                          onChange={event => setNoteDraft(event.target.value)}
                          onBlur={() => void saveNote()}
                          onKeyDown={event => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              skipNoteBlur.current = true
                              setEditingNoteId(null)
                              setNoteDraft('')
                            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                              event.preventDefault()
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      ) : (
                        <div
                          className="pms-paper-note__text"
                          role="button"
                          tabIndex={0}
                          title="点一下改这句话"
                          onClick={() => beginEditNote(item)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              beginEditNote(item)
                            }
                          }}
                        >{item.body}</div>
                      )}
                      <div className="pms-paper-note__foot">
                        {item.edited_at ? <span>已编辑 · {formatClock(item.edited_at)}</span> : <span>点文字可改</span>}
                        {savingNote && editingNoteId === item.id && <span>保存中…</span>}
                      </div>
                    </div>
                  </article>
                )) : (
                  <p className="pms-paper-empty">还没有写过。先写一句你真正想说的，分析不会覆盖原文。</p>
                )}
              </div>
            </div>
          )}
        </div>

        {currentId && (
          <footer className="pms-paper-composer">
            <div className="pms-paper-composer__inner">
              <div className="pms-paper-capture">
                <button className="pms-paper-capture__plus" type="button" aria-label="写一句" onClick={() => inputRef.current?.focus()}>+</button>
                <textarea
                  ref={inputRef}
                  data-testid="focus-input"
                  rows={1}
                  value={body}
                  placeholder="写下去，不用先想好。"
                  aria-label="写下你的判断"
                  onChange={event => updateBody(event.target.value)}
                />
              </div>
              {(error || loadError) && <div className="pms-paper-error">{error || loadError}</div>}
              <div className="pms-paper-composer__foot">
                <span className="pms-paper-composer__hint">{body.trim() ? '草稿 · 记下后才算落笔' : 'Ctrl + Enter 记下并换一张'}</span>
                <span className="pms-spacer" />
                <button className="pms-paper-quiet" type="button" data-testid="focus-append" disabled={busy || !body.trim()} onClick={() => void act('append')}>只保存</button>
                <button
                  className="pms-paper-btn pms-paper-btn--ink"
                  type="button"
                  data-testid="focus-shelve"
                  disabled={busy}
                  title="记下这句，换下一张。Ctrl + Enter"
                  onClick={() => void act('shelve')}
                >{body.trim() ? '记下，换一张' : '跳过，换一张'}</button>
                <button
                  className="pms-paper-quiet"
                  type="button"
                  data-testid="focus-mature"
                  disabled={busy || (!detail?.interactions.length && !body.trim())}
                  title={detail?.interactions.length || body.trim() ? '把当前输入一并收好，送去改稿（可撤销）' : '先写一句，再标为成熟'}
                  onClick={() => setConfirmMature(true)}
                >标为成熟</button>
              </div>
            </div>
          </footer>
        )}
      </div>

      {analysisOpen && currentId && (
        <aside className="pms-paper-aside" data-testid="focus-analysis">
          <div className="pms-paper-aside__head">
            <div>
              <h2>批注</h2>
              <p>后台自动更新 · 不改你的原话</p>
            </div>
            <button className="pms-paper-quiet" type="button" onClick={() => setAnalysisOpen(false)}>收起</button>
          </div>
          {pending && <p className="pms-paper-aside__note">正在整理这张卡，你可以先写。</p>}
          {!analysis && !pending && <p className="pms-paper-aside__note">保存一句后，这里会出现核心判断、缺口、追问和相关素材。</p>}
          {analysis && (
            <>
              <section className="pms-paper-aside__section">
                <h3>核心判断</h3>
                <p data-testid="focus-thesis">{analysis.thesis}</p>
              </section>
              {analysis.gaps.length > 0 && (
                <section className="pms-paper-aside__section">
                  <h3>还缺什么</h3>
                  <ul>{analysis.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
                </section>
              )}
              {analysis.perspectives.length > 0 && (
                <section className="pms-paper-aside__section">
                  <h3>正反视角</h3>
                  <ul>{analysis.perspectives.map((item, index) => <li key={index}>{item.stance} — {item.counter}</li>)}</ul>
                </section>
              )}
              {questions.length > 0 && (
                <section className="pms-paper-aside__section">
                  <h3>继续问</h3>
                  <ul>{questions.map(item => <li key={item.id}>{item.text}</li>)}</ul>
                </section>
              )}
              {analysis.relatedAssets.length > 0 && (
                <section className="pms-paper-aside__section">
                  <h3>相关素材</h3>
                  <ul>{analysis.relatedAssets.map(asset => <li key={asset.assetId}>{asset.title}</li>)}</ul>
                </section>
              )}
            </>
          )}
        </aside>
      )}

      {confirmMature && (
        <FocusConfirm
          title="标为成熟，送去改稿？"
          description="这张卡会离开选题阶段。改稿页里仍然可以退回选题。"
          confirmLabel="标为成熟并送去改稿"
          onCancel={() => setConfirmMature(false)}
          onConfirm={() => { setConfirmMature(false); void act('mature') }}
        />
      )}
      {confirmDelete && (
        <FocusConfirm
          tone="danger"
          title="删除这张卡？"
          description="卡片会从看板移除，写下的原话一起收进回收站；提示里可以撤销。"
          confirmLabel="删除"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); void removeCard() }}
        />
      )}
    </div>
  )
}

function Production({ cardId, onReview }: { cardId: string, onReview: () => void }) {
  const [project, setProject] = useState<ProjectView | null>(null)
  const [pages, setPages] = useState<PageModel[]>([])
  const [suggestions, setSuggestions] = useState<Array<{ id: string, text: string }>>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<AssetHit[]>([])

  async function load() {
    const value = await rpc<ProjectView | null>('getProject', { cardId })
    setProject(value)
    setPages(value?.pages ?? [])
    const detail = await rpc<CardDetail>('getCard', { cardId })
    setSuggestions(detail.suggestions.filter(item => item.status === 'open').map(item => ({ id: item.id, text: item.text })))
  }
  useEffect(() => { void load().catch(err => setError(err instanceof Error ? err.message : String(err))) }, [cardId])

  function editPages(next: PageModel[]) {
    setPages(next)
    if (!project?.draft) return
    void rpc('saveDraft', { draftId: project.draft.id, pages: next }).catch(err => setError(err instanceof Error ? err.message : String(err)))
  }

  if (error) return <div className="pms-error">{error}</div>
  if (!project?.draft) return <div className="pms-empty">正在组织标题、小标题和可追溯的素材…</div>
  return (
    <div data-testid="production">
      <div className="pms-row">
        <h2 style={{ margin: 0 }}>{project.draft.title}</h2>
        <span className="pms-badge">{pages.length} 页，随内容伸缩</span>
        <button className="pms-btn primary" data-testid="enter-review" onClick={onReview}>文字已定稿，送去渲染</button>
      </div>
      <div className="pms-split" style={{ marginTop: 16 }}>
        <section className="pms-col" data-testid="draft-structure">
          <h3>标题、小标题、金句</h3>
          <p className="pms-note">这里只改结构。版式和导出在渲染阶段，不会改你已经写下的原句。</p>
          {pages.map(page => (
            <article key={page.id} style={{ marginBottom: 16 }}>
              <div className="pms-kicker">{roleLabel(page.role)}</div>
              <label className="pms-field">
                <span>{page.role === 'cover' ? '标题' : '小标题'}</span>
                <input aria-label={page.role === 'cover' ? '标题' : '小标题'} value={page.title} onChange={event => editPages(pages.map(item => item.id === page.id ? { ...item, title: event.target.value } : item))} />
              </label>
              {page.blocks.filter(block => block.type === 'paragraph').map(block => (
                <label key={block.id} className="pms-field">
                  <span>正文</span>
                  <textarea rows={3} value={spanText(block.spans, block.text)} onChange={event => editPages(pages.map(item => item.id === page.id ? { ...item, blocks: item.blocks.map(candidate => candidate.id === block.id ? { ...candidate, text: event.target.value, spans: [{ ...(candidate.spans?.[0] ?? {}), text: event.target.value }] } : candidate) } : item))} />
                  <button className="pms-btn" type="button" onClick={() => editPages(pages.map(item => item.id === page.id ? { ...item, blocks: item.blocks.map(candidate => candidate.id === block.id ? { ...candidate, spans: [{ text: spanText(candidate.spans, candidate.text), bold: !candidate.spans?.[0]?.bold }] } : candidate) } : item))}>{block.spans?.[0]?.bold ? '取消加黑' : '加黑'}</button>
                </label>
              ))}
              {page.blocks.filter(block => block.type === 'quote').map(block => (
                <label key={block.id} className="pms-field">
                  <span>金句</span>
                  <textarea rows={2} value={block.text ?? ''} onChange={event => editPages(pages.map(item => item.id === page.id ? { ...item, blocks: item.blocks.map(candidate => candidate.id === block.id ? { ...candidate, text: event.target.value } : candidate) } : item))} />
                </label>
              ))}
            </article>
          ))}
        </section>
        <aside className="pms-panel" data-testid="asset-matching">
          <h3>可以参考的建议</h3>
          {suggestions.length === 0 && <p className="pms-note">分析追问会出现在这里，不会自动改你的句子。</p>}
          <ul>{suggestions.map(item => <li key={item.id}>{item.text}</li>)}</ul>
          <h3>真实本地素材</h3>
          <p className="pms-note">建议来自你的素材库，带源文件路径。接受、拒绝或换成另一张，都由你点。</p>
          {project.relations.map(relation => (
            <div key={relation.id} className="pms-asset" data-testid="asset-relation">
              {/\.(png|jpe?g|webp|gif)$/i.test(relation.source_path) ? <img alt="" src={assetUrl(String(relation.asset_id))} /> : <div className="pms-ph" />}
              <div>
                <span className={relation.status === 'accepted' ? 'pms-badge' : 'pms-badge warn'}>{relationLabel(relation.status)}</span>
                <small>{relation.source_path}</small>
                <span>{relation.rationale}</span>
                <div className="pms-row">
                  <button className="pms-btn" data-testid="accept-asset" onClick={() => void rpc('decideAsset', { relationId: relation.id, decision: 'accepted' }).then(load)}>接受</button>
                  <button className="pms-btn" onClick={() => void rpc('decideAsset', { relationId: relation.id, decision: 'rejected' }).then(load)}>拒绝</button>
                </div>
              </div>
            </div>
          ))}
          <div className="pms-field">
            <label>换成库里的另一张</label>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文件名或笔记" />
            <button className="pms-btn" onClick={() => void rpc<AssetHit[]>('searchAssets', { query }).then(setFound)}>搜索</button>
          </div>
          {found.map(asset => (
            <button key={asset.assetId} className="pms-btn" onClick={() => {
              const relation = project.relations.find(item => item.status === 'suggested' || item.status === 'accepted')
              if (!relation) return
              void rpc('decideAsset', { relationId: relation.id, decision: 'replaced', replacementAssetId: asset.assetId }).then(load)
            }}>{asset.title}</button>
          ))}
        </aside>
      </div>
    </div>
  )
}

type PageEdit = { field: string, blockId?: string | null, text?: string, html?: string }

function Workbench({ cardId, onReturn }: { cardId: string, onReturn?: () => void }) {
  const [project, setProject] = useState<ProjectView | null>(null)
  const [pages, setPages] = useState<PageModel[]>([])
  const [template, setTemplate] = useState<keyof typeof THEMES>('avatar-green')
  const [pageSize, setPageSize] = useState<'small' | 'standard' | 'large'>('standard')
  const [current, setCurrent] = useState(0)
  const [past, setPast] = useState<PageModel[][]>([])
  const [future, setFuture] = useState<PageModel[][]>([])
  const [saved, setSaved] = useState('等待改动')
  const [scale, setScale] = useState(0.42)
  const [instruction, setInstruction] = useState('把这一页收短，留下一句能被截图的话')
  const [proposal, setProposal] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<string | null>(null)
  const commitFrameRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    void rpc<ProjectView>('getProject', { cardId }).then(value => {
      setProject(value)
      setPages(value.pages)
      const incoming = value.project.template === 'tech' ? 'navy-gold' : value.project.template === 'knowledge' ? 'avatar-green' : value.project.template === 'opinion' ? 'gongwen' : value.project.template
      if (incoming in THEMES) setTemplate(incoming as keyof typeof THEMES)
      if (value.project.page_size === 'small' || value.project.page_size === 'large' || value.project.page_size === 'standard') setPageSize(value.project.page_size)
    }).catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [cardId])

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const apply = () => setScale(Math.min(0.72, Math.max(0.28, (node.clientWidth - 24) / 1080)))
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [project])

  function commit(next: PageModel[]) {
    setPast(stack => [...stack.slice(-49), pages])
    setFuture([])
    setPages(next)
  }

  useEffect(() => {
    if (!project?.draft || pages.length === 0) return
    const handle = window.setTimeout(() => {
      setSaved('保存中…')
      void rpc('saveDraft', { draftId: project.draft.id, pages, template, pageSize }).then(() => setSaved('已自动保存')).catch(err => setSaved(err instanceof Error ? err.message : '保存失败'))
    }, 700)
    return () => window.clearTimeout(handle)
  }, [pages, template, pageSize])

  const page = pages[current]
  const theme = THEMES[template]
  const versions = useMemo(() => project?.draft.id, [project])

  function updatePage(patch: Partial<PageModel>) {
    commit(pages.map((item, index) => index === current ? { ...item, ...patch } : item))
  }

  function commitFrameNow() {
    commitFrameRef.current?.()
  }

  function applyPageEdit(data: PageEdit) {
    const text = (data.text ?? '').replace(/\u00a0/g, ' ')
    if (data.field === 'title') {
      if (text.trim()) updatePage({ title: text.trim() })
      return
    }
    if (data.field === 'kicker') {
      updatePage({ kicker: text.trim() })
      return
    }
    if (data.field === 'caption' && data.blockId) {
      updatePage({ blocks: page.blocks.map(block => block.id === data.blockId ? { ...block, caption: text } : block) })
      return
    }
    if (data.field !== 'block' || !data.blockId) return
    const host = document.createElement('div')
    host.innerHTML = data.html ?? ''
    updatePage({
      blocks: page.blocks.map(block => {
        if (block.id !== data.blockId) return block
        if (block.type === 'quote') return { ...block, text }
        return { ...block, text, spans: serializeSpans(host) }
      }),
    })
  }

  if (!project?.draft || !page) return <div className="pms-empty">{error || '正在铺开审定台…'}</div>
  return (
    <div className="pms-workbench" data-testid="workbench">
      <aside className="pms-col pms-thumbs" data-testid="page-list">
        {onReturn && <button className="pms-btn" onClick={() => { commitFrameNow(); void rpc('returnToDrafts', { cardId }).then(onReturn) }}>退回生产改稿</button>}
        {pages.map((item, index) => (
          <button
            key={item.id}
            className={index === current ? 'pms-thumb active' : 'pms-thumb'}
            draggable
            onDragStart={() => { drag.current = item.id }}
            onDragOver={event => event.preventDefault()}
            onDrop={() => {
              const from = pages.findIndex(candidate => candidate.id === drag.current)
              if (from < 0 || from === index) return
              const next = [...pages]
              const [moved] = next.splice(from, 1)
              next.splice(index, 0, moved)
              commit(next)
              setCurrent(index)
            }}
            onClick={() => {
              if (index === current) return
              commitFrameNow()
              setCurrent(index)
            }}
          >
            <strong>{index + 1}. {item.title}</strong>
            <div className="pms-meta">{roleLabel(item.role)}</div>
          </button>
        ))}
        <button className="pms-btn" data-testid="add-page" onClick={() => commit([...pages, { id: crypto.randomUUID(), ordinal: pages.length, role: 'content', kicker: '补页', title: '新的一页', blocks: [{ id: crypto.randomUUID(), type: 'paragraph', spans: [{ text: '在这里写下这一页只说一件事。' }] }], style: {} }])}>加一页</button>
        <button className="pms-btn" disabled={pages.length < 2} onClick={() => { const next = pages.filter((_, index) => index !== current); commit(next); setCurrent(Math.max(0, current - 1)) }}>删除此页</button>
      </aside>
      <section className="pms-stage" ref={stageRef} data-testid="page-canvas">
        <div className="pms-canvas-wrap" style={{ width: 1080 * scale, height: 1440 * scale }}>
          <div style={{ width: 1080, height: 1440, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <BrandFrame page={page} template={template} size={pageSize} index={current} total={pages.length} onEdit={applyPageEdit} commitRef={commitFrameRef} />
          </div>
        </div>
      </section>
      <aside className="pms-col pms-props" data-testid="properties">
        <div className="pms-row">
          <button className="pms-btn" onClick={() => { const previous = past[past.length - 1]; if (!previous) return; setFuture(stack => [pages, ...stack]); setPast(stack => stack.slice(0, -1)); setPages(previous) }}>撤销</button>
          <button className="pms-btn" onClick={() => { const next = future[0]; if (!next) return; setPast(stack => [...stack, pages]); setFuture(stack => stack.slice(1)); setPages(next) }}>重做</button>
          <span className="pms-meta" data-testid="save-state">{saved}</span>
        </div>
        <div className="pms-field">
          <label>模板</label>
          <select data-testid="template" value={template} onChange={event => { commitFrameNow(); setTemplate(event.target.value as keyof typeof THEMES) }}>
            <option value="avatar-green">头像绿（默认）</option>
            <option value="navy-gold">深蓝金</option>
            <option value="gongwen">公文风</option>
          </select>
          <label htmlFor="page-size">字号（画布保持 1080×1440）</label>
          <select id="page-size" data-testid="page-size" value={pageSize} onChange={event => { commitFrameNow(); setPageSize(event.target.value as 'small' | 'standard' | 'large') }}>
            <option value="small">小</option>
            <option value="standard">标准</option>
            <option value="large">大</option>
          </select>
          <label htmlFor="page-title">这一页标题</label>
          <input id="page-title" data-testid="page-title" value={page.title} onChange={event => updatePage({ title: event.target.value })} />
        </div>
        <ColorField label="背景" value={page.style.background || theme.paper} presets={['#f6f1e7', '#fffaf3', '#0b1220', '#fff7f2', '#1c1917']} onChange={color => updatePage({ style: { ...page.style, background: color } })} />
        <ColorField label="强调色" value={page.style.accent || theme.accent} presets={['#c4552a', '#3ee0c5', '#d4533a', '#1c1917', '#f6f1e7']} onChange={color => updatePage({ style: { ...page.style, accent: color } })} />
        <div className="pms-row">
          <button className="pms-btn" onClick={() => document.execCommand('bold')}>加黑</button>
          <button className="pms-btn" onClick={() => document.execCommand('hiliteColor', false, '#ffe08a')}>高亮</button>
        </div>
        {page.blocks.filter(block => block.type === 'image').map(block => {
          const crop = block.crop ?? { x: 50, y: 50, scale: 1 }
          const setCrop = (next: { x: number, y: number, scale: number }) => updatePage({ blocks: page.blocks.map(item => item.id === block.id ? { ...item, crop: next } : item) })
          return (
            <div key={block.id} className="pms-field">
              <span className="pms-slider-label"><span>横向偏移 X</span><span>{crop.x}</span></span>
              <input aria-label="横向偏移 X" type="range" min={0} max={100} value={crop.x} onChange={event => setCrop({ ...crop, x: Number(event.target.value) })} />
              <span className="pms-slider-label"><span>纵向偏移 Y</span><span>{crop.y}</span></span>
              <input aria-label="纵向偏移 Y" type="range" min={0} max={100} value={crop.y} onChange={event => setCrop({ ...crop, y: Number(event.target.value) })} />
              <span className="pms-slider-label"><span>缩放比例</span><span>{crop.scale.toFixed(2)}</span></span>
              <input aria-label="缩放比例" type="range" min={100} max={200} value={Math.round(crop.scale * 100)} onChange={event => setCrop({ ...crop, scale: Number(event.target.value) / 100 })} />
              <button className="pms-btn" type="button" onClick={() => setCrop({ x: 50, y: 50, scale: 1 })}>重置裁切</button>
            </div>
          )
        })}
        <div className="pms-field">
          <label>让模型改这一页，采用前先看建议</label>
          <textarea rows={3} value={instruction} onChange={event => setInstruction(event.target.value)} />
          <button className="pms-btn" data-testid="ai-edit" onClick={() => void rpc<{ paragraphs: string[] }>('proposeEdit', { draftId: project.draft.id, pageId: page.id, instruction }).then(result => setProposal(result.paragraphs)).catch(err => setError(err instanceof Error ? err.message : String(err)))}>生成修改建议</button>
          {proposal && (
            <div data-testid="ai-proposal">
              {proposal.map(line => <p key={line}>{line}</p>)}
              <div className="pms-row">
                <button className="pms-btn primary" onClick={() => { void rpc('confirmEdit', { draftId: project.draft.id, pageId: page.id, paragraphs: proposal }).then(() => rpc<ProjectView>('getProject', { cardId })).then(value => { setPages(value.pages); setProposal(null) }) }}>采用</button>
                <button className="pms-btn" onClick={() => setProposal(null)}>放弃</button>
              </div>
            </div>
          )}
        </div>
        <button className="pms-btn" onClick={() => void rpc('snapshot', { draftId: project.draft.id, label: '手动版本' })}>保存版本</button>
        <VersionList draftId={project.draft.id} token={versions} onRestore={() => void rpc<ProjectView>('getProject', { cardId }).then(value => setPages(value.pages))} />
        <button className="pms-btn primary" data-testid="export" onClick={() => void rpc<{ dir: string }>('exportProject', { cardId }).then(result => setSaved(`已导出 ${result.dir}`)).catch(err => setError(err instanceof Error ? err.message : String(err)))}>导出 PNG、正文和 article.md</button>
        {error && <div className="pms-error">{error}</div>}
      </aside>
    </div>
  )
}

function VersionList({ draftId, token, onRestore }: { draftId: string, token: string | undefined, onRestore: () => void }) {
  const [rows, setRows] = useState<Array<{ id: string, label: string }>>([])
  useEffect(() => { void rpc<Array<{ id: string, label: string }>>('listVersions', { draftId }).then(setRows).catch(() => undefined) }, [draftId, token])
  if (rows.length === 0) return null
  return (
    <div>
      {rows.slice(0, 5).map(row => <button key={row.id} className="pms-btn" onClick={() => void rpc('restoreVersion', { versionId: row.id }).then(onRestore)}>{row.label}</button>)}
    </div>
  )
}

function TextGate({ cardId, onConfirmed }: { cardId: string, onConfirmed: () => void }) {
  const [gate, setGate] = useState<{ verbatim: string, note: string, suggestions: Array<{ id: string, text: string }>, warnings: string[], duplicate: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void rpc<NonNullable<typeof gate>>('textGate', { cardId }).then(setGate).catch(err => setError(err instanceof Error ? err.message : String(err))) }, [cardId])
  if (!gate) return <div className="pms-empty">{error || '正在取出你的原话…'}</div>
  return (
    <div data-testid="text-gate" className="pms-col">
      <h2 style={{ marginTop: 0 }}>纯文字定稿</h2>
      <p>{gate.note}</p>
      {gate.duplicate && <p className="pms-badge warn">{gate.duplicate}</p>}
      {gate.warnings.map(item => <p key={item} className="pms-badge warn">{item}</p>)}
      <pre data-testid="verbatim" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{gate.verbatim}</pre>
      <h3>可以采纳的建议（不改原句）</h3>
      <ul>{gate.suggestions.map(item => <li key={item.id}>{item.text}</li>)}</ul>
      {error && <div className="pms-error">{error}</div>}
      <button className="pms-btn primary" data-testid="confirm-text" disabled={busy} onClick={() => {
        setBusy(true)
        void rpc('startProduction', { cardId }).then(() => onConfirmed()).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false))
      }}>确认定稿，进入排版</button>
    </div>
  )
}

function BrandFrame({ page, template, size, index, total, onEdit, commitRef }: { page: PageModel, template: string, size: string, index: number, total: number, onEdit?: (data: PageEdit) => void, commitRef?: { current: (() => void) | null } }) {
  const [html, setHtml] = useState('')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const editRef = useRef(onEdit)
  editRef.current = onEdit
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void rpc<{ html: string }>('previewPage', { page, template, size, index, total, editable: true }).then(result => setHtml(result.html)).catch(() => undefined)
    }, 180)
    return () => window.clearTimeout(handle)
  }, [page, template, size, index, total])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const message = event.data as { __pms?: boolean, type?: string, pageId?: string, data?: PageEdit } | null
      if (!message?.__pms || message.type !== 'commit' || message.pageId !== page.id || !message.data) return
      editRef.current?.(message.data)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [page.id])

  useEffect(() => {
    if (!commitRef) return
    commitRef.current = () => {
      const win = frameRef.current?.contentWindow as (Window & { __pmsCommit?: () => PageEdit | null }) | null
      const data = win?.__pmsCommit?.()
      if (data) editRef.current?.(data)
    }
    return () => { commitRef.current = null }
  }, [commitRef])
  return <iframe ref={frameRef} title="1080×1440 预览" data-testid="brand-frame" srcDoc={html} style={{ width: 1080, height: 1440, border: 0, background: '#F5F6F0' }} />
}

function imageFrame(crop?: { x: number, y: number, scale: number }) {
  const frame = crop ?? { x: 50, y: 50, scale: 1 }
  return { transform: `translate(${((frame.x - 50) * 0.7).toFixed(2)}%, ${((frame.y - 50) * 0.7).toFixed(2)}%) scale(${frame.scale})` }
}

function ColorField({ label, value, presets, onChange }: { label: string, value: string, presets: string[], onChange: (color: string) => void }) {
  return (
    <div className="pms-field">
      <label>{label}</label>
      <div className="pms-swatches">
        {presets.map(color => (
          <button key={color} type="button" className={color.toLowerCase() === value.toLowerCase() ? 'on' : ''} style={{ background: color }} aria-label={`${label} ${color}`} onClick={() => onChange(color)} />
        ))}
        <label className="pms-color-hit">
          <input aria-label={`${label}自定义`} type="color" value={toHex(value)} onChange={event => onChange(event.target.value)} />
          <span style={{ background: value }} />
        </label>
        <span className="pms-hex">{toHex(value)}</span>
      </div>
    </div>
  )
}

function toHex(color: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : color
}

function EditableBlock({ block, quoteBg, accent, bodySize, onCommit }: { block: Block, quoteBg: string, accent: string, bodySize: number, onCommit: (block: Block) => void }) {
  const ref = useRef<HTMLElement>(null)
  const html = block.type === 'quote' ? escapeText(block.text ?? '') : spansToHtml(block.spans ?? [{ text: block.text ?? '' }])
  useEffect(() => {
    const node = ref.current
    if (!node || document.activeElement === node) return
    if (node.innerHTML !== html) node.innerHTML = html
  }, [html])
  if (block.type === 'quote') {
    return <blockquote ref={ref as never} className="quote" style={{ background: quoteBg, borderLeftColor: accent }} contentEditable suppressContentEditableWarning onBlur={() => onCommit({ ...block, text: ref.current?.innerText ?? '' })} />
  }
  return <p ref={ref as never} className="paragraph" style={{ fontSize: bodySize }} contentEditable suppressContentEditableWarning onBlur={() => onCommit({ ...block, spans: serializeSpans(ref.current as HTMLElement) })} />
}

function escapeText(value: string) {
  return value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))
}

function spansToHtml(spans: Span[]) {
  return spans.map(span => {
    let html = span.text.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))
    if (span.highlight) html = `<mark>${html}</mark>`
    if (span.bold) html = `<strong>${html}</strong>`
    return html
  }).join('')
}

function serializeSpans(root: HTMLElement): Span[] {
  const spans: Span[] = []
  const walk = (node: Node, bold: boolean, highlight: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) spans.push({ text, bold: bold || undefined, highlight: highlight || undefined })
      return
    }
    if (!(node instanceof HTMLElement)) return
    const style = node.getAttribute('style') ?? ''
    const nextBold = bold || node.tagName === 'STRONG' || node.tagName === 'B' || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style)
    const nextHighlight = highlight || node.tagName === 'MARK' || /background-color/i.test(style)
    node.childNodes.forEach(child => walk(child, nextBold, nextHighlight))
  }
  walk(root, false, false)
  return spans.length > 0 ? spans : [{ text: root.innerText }]
}
