import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import css from './styles.css'

const PANEL_ID = 'personal-media'

interface ClientCtx {
  effect(run: () => void | (() => void)): void
  slots: {
    inject(name: string, register: () => unknown): void
    register(meta: Record<string, unknown>, component: (props: { size?: number, active?: boolean }) => ReactElement): unknown
  }
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
  updated_at: string
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
interface CardDetail {
  card: CardRow & { input_version: number }
  interactions: Array<{ id: string, body: string, created_at: string, attachments_json: string }>
  analysis: AnalysisView | null
  suggestions: Array<{ id: string, kind: string, text: string, status: string }>
  job: { status?: string } | null
}
interface ProjectView {
  project: { id: string, template: string, status: string }
  draft: { id: string, title: string, version: number }
  pages: PageModel[]
  relations: Array<{ id: string, asset_id: string, status: string, rationale: string, source_path: string, draft_page_id: string }>
}

const THEMES = {
  knowledge: { paper: '#f6f1e7', ink: '#1c1917', accent: '#c4552a', font: '"Songti SC","WenQuanYi Micro Hei",serif', quote: '#efe4d4' },
  tech: { paper: '#0b1220', ink: '#e7eefc', accent: '#3ee0c5', font: '"Segoe UI","WenQuanYi Micro Hei",sans-serif', quote: '#132033' },
  opinion: { paper: '#fff7f2', ink: '#3b2416', accent: '#d4533a', font: '"WenQuanYi Micro Hei",sans-serif', quote: '#ffe8df' },
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

function spanText(spans?: Span[], fallback = '') {
  return spans?.map(span => span.text).join('') || fallback
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    open: '进行中', shelved: '已搁置', ready_for_production: '待生产', in_production: '生产中', reviewing: '审定中', exported: '已导出', deleted: '已删除',
  }
  return map[status] ?? status
}

export const inject = ['slots', 'layout']

export function apply(ctx: ClientCtx) {
  const style = document.createElement('style')
  style.dataset.pms = 'personal-media-studio'
  style.textContent = css
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, () => <StudioApp />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 8,
    label: () => '个人媒体工作室',
  }, StudioIcon))
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

function StudioApp() {
  const [boot, setBoot] = useState<{ engine: { mode: string, reason: string }, libraryCount: number, cards: CardRow[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'home' | 'card' | 'production' | 'review'>('home')
  const [cardId, setCardId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: string, title: string } | null>(null)

  async function refresh() {
    const data = await rpc<NonNullable<typeof boot>>('bootstrap')
    setBoot(data)
    return data
  }

  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false))
  }, [])

  function openCard(id: string) {
    setCardId(id)
    setView('card')
  }

  return (
    <div className="pms-root" data-testid="studio-root">
      <header className="pms-top">
        <div>
          <p className="pms-kicker">Personal Media Studio</p>
          <h1>个人媒体工作室</h1>
          <p className="pms-sub">先选一张选题卡，把判断写下来。分析在后台发生，你随时可以换一张。</p>
        </div>
        <div className="pms-actions">
          {boot && (
            <span className={boot.engine.mode === 'llm' ? 'pms-badge' : 'pms-badge warn'} data-testid="engine-badge" title={boot.engine.reason}>
              {boot.engine.mode === 'llm' ? '模型已连接' : '本地预览引擎'}
            </span>
          )}
          {view !== 'home' && <button className="pms-btn" onClick={() => { setView('home'); void refresh() }}>返回选题</button>}
          {view === 'home' && <NewCard onCreated={id => { void refresh(); openCard(id) }} />}
        </div>
      </header>
      <div className="pms-body">
        {loading && <div className="pms-empty" data-testid="loading">正在打开你的选题卡片…</div>}
        {error && <div className="pms-error" data-testid="error">{error}</div>}
        {!loading && !error && view === 'home' && boot && (
          <Home cards={boot.cards} libraryCount={boot.libraryCount} onOpen={openCard} />
        )}
        {view === 'card' && cardId && (
          <CardWorkspace
            cardId={cardId}
            onShelved={() => { setView('home'); void refresh() }}
            onDeleted={id => { setToast({ id, title: '卡片已删除' }); setView('home'); void refresh() }}
            onProduce={() => setView('production')}
          />
        )}
        {view === 'production' && cardId && <Production cardId={cardId} onReview={() => setView('review')} />}
        {view === 'review' && cardId && <Workbench cardId={cardId} />}
      </div>
      {toast && (
        <div className="pms-toast" data-testid="undo-toast">
          <span>{toast.title}</span>
          <button className="pms-btn" onClick={() => { void rpc('restoreCard', { cardId: toast.id }).then(() => refresh()); setToast(null) }}>撤销</button>
        </div>
      )}
    </div>
  )
}

function NewCard({ onCreated }: { onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(false)
  if (!open) return <button className="pms-btn primary" data-testid="new-card" onClick={() => setOpen(true)}>新建选题</button>
  return (
    <form className="pms-row" onSubmit={event => {
      event.preventDefault()
      void rpc<{ card: { id: string } }>('createCard', { title }).then(result => onCreated(result.card.id))
    }}>
      <input aria-label="选题标题" value={title} onChange={event => setTitle(event.target.value)} placeholder="这张卡想讲什么" />
      <button className="pms-btn primary" type="submit">创建</button>
    </form>
  )
}

function Home({ cards, libraryCount, onOpen }: { cards: CardRow[], libraryCount: number, onOpen: (id: string) => void }) {
  return (
    <div data-testid="topic-center">
      <p className="pms-sub">本地素材 {libraryCount} 条。推荐卡来自工作室，你创建的卡会标成「我的」。</p>
      {cards.length === 0 && <div className="pms-empty">还没有卡片。先新建一张选题，或者等素材库扫描出推荐。</div>}
      <div className="pms-grid">
        {cards.map(card => (
          <button key={card.id} className="pms-card" data-testid="topic-card" onClick={() => onOpen(card.id)}>
            <div className="pms-row">
              <span className="pms-badge">{card.source === 'user' ? '我的' : '推荐'}</span>
              <span className="pms-meta">{statusLabel(card.status)}</span>
            </div>
            <h2>{card.title}</h2>
            <p>{card.latestThesis || '还没有写过。点开就能直接说。'}</p>
            <div className="pms-meta"><span>成熟度 {card.maturity}</span></div>
          </button>
        ))}
      </div>
    </div>
  )
}

function CardWorkspace({ cardId, onShelved, onDeleted, onProduce }: { cardId: string, onShelved: () => void, onDeleted: (id: string) => void, onProduce: () => void }) {
  const [detail, setDetail] = useState<CardDetail | null>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [assets, setAssets] = useState<AssetHit[]>([])
  const [linked, setLinked] = useState<string[]>([])

  async function load() {
    const next = await rpc<CardDetail>('getCard', { cardId })
    setDetail(next)
  }

  useEffect(() => {
    void load().catch(err => setError(err instanceof Error ? err.message : String(err)))
    const timer = window.setInterval(() => { void load().catch(() => undefined) }, 1200)
    return () => window.clearInterval(timer)
  }, [cardId])

  async function save(shelve: boolean) {
    setBusy(true)
    setError('')
    try {
      if (body.trim() || linked.length > 0) await rpc('appendThought', { cardId, body, attachmentAssetIds: linked })
      if (shelve) {
        await rpc('shelve', { cardId })
        onShelved()
        return
      }
      setBody('')
      setLinked([])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function produce() {
    setBusy(true)
    try {
      await rpc('promote', { cardId })
      await rpc('startProduction', { cardId })
      onProduce()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!detail) return <div className="pms-empty">{error || '正在打开卡片…'}</div>
  const analysis = detail.analysis
  return (
    <div className="pms-split" data-testid="card-workspace">
      <section className="pms-col">
        <div className="pms-row">
          <h2 style={{ margin: 0 }}>{detail.card.title}</h2>
          <span className="pms-badge">{statusLabel(String(detail.card.status))}</span>
        </div>
        <div className="pms-timeline" data-testid="expressions">
          {detail.interactions.length === 0 && <div className="pms-empty">这里会按时间保留你写过的每一句，分析不会覆盖原文。</div>}
          {detail.interactions.map(item => <article key={item.id} className="pms-thought" data-testid="thought">{item.body}</article>)}
        </div>
        <div className="pms-composer">
          <textarea data-testid="thought-input" rows={5} value={body} placeholder="把判断、场景、犹豫都写在这里。保存是追加，不是覆盖。" onChange={event => setBody(event.target.value)} />
          <div className="pms-row">
            <button className="pms-btn" type="button" onClick={() => { void rpc<AssetHit[]>('searchAssets', { query: body || detail.card.title }).then(setAssets) }}>关联本地素材</button>
            {linked.length > 0 && <span className="pms-meta">已关联 {linked.length} 条</span>}
          </div>
          {assets.length > 0 && assets.map(asset => (
            <label key={asset.assetId} className="pms-asset">
              <input type="checkbox" checked={linked.includes(asset.assetId)} onChange={() => setLinked(list => list.includes(asset.assetId) ? list.filter(id => id !== asset.assetId) : [...list, asset.assetId])} />
              <span>{asset.title}<small>{asset.sourcePath}</small></span>
            </label>
          ))}
          {error && <div className="pms-error">{error}</div>}
          <div className="pms-row">
            <button className="pms-btn" disabled={busy} onClick={() => void save(false)}>追加保存</button>
            <button className="pms-btn primary" data-testid="shelve" disabled={busy} onClick={() => void save(true)}>暂存并换一张</button>
            <button className="pms-btn" data-testid="promote" disabled={busy || detail.interactions.length === 0} onClick={() => void produce()}>我决定进入内容生产</button>
            <button className="pms-btn" data-testid="delete-card" onClick={() => { void rpc('deleteCard', { cardId }).then(() => onDeleted(cardId)) }}>删除</button>
          </div>
        </div>
      </section>
      <aside className="pms-panel pms-analysis" data-testid="analysis-panel">
        <h3>后台分析</h3>
        {detail.job?.status === 'queued' || detail.job?.status === 'running' ? <p data-testid="analysis-pending">正在后台整理这张卡，你可以先去看别的。</p> : null}
        {!analysis && <p>搁置或保存之后，这里会出现核心判断、缺口、相反视角和追问。</p>}
        {analysis && (
          <>
            <span className={analysis.engine === 'llm' ? 'pms-badge' : 'pms-badge warn'}>{analysis.engine === 'llm' ? '模型分析' : '本地预览引擎'}</span>
            <div>
              <h3>核心判断</h3>
              <p data-testid="analysis-thesis">{analysis.thesis}</p>
            </div>
            <div>
              <h3>故事与案例</h3>
              <ul>{analysis.stories.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h3>还缺什么</h3>
              <ul>{analysis.gaps.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h3>视角与反视角</h3>
              <ul>{analysis.perspectives.map(item => <li key={item.stance}><strong>{item.stance}</strong> — {item.counter}</li>)}</ul>
            </div>
            <div>
              <h3>继续问</h3>
              <ul data-testid="questions">{detail.suggestions.filter(item => item.kind === 'question').map(item => <li key={item.id}>{item.text}</li>)}</ul>
            </div>
            <div>
              <h3>相关本地素材</h3>
              {analysis.relatedAssets.length === 0 && <p>库里还没有和这段话对得上的文件。</p>}
              {analysis.relatedAssets.map(asset => (
                <div key={asset.assetId} className="pms-asset" data-testid="related-asset">
                  {asset.kind === 'image' ? <img alt="" src={assetUrl(asset.assetId)} /> : <div className="pms-ph" />}
                  <div><strong>{asset.title}</strong><small>{asset.sourcePath}</small><span>{asset.rationale}</span></div>
                </div>
              ))}
            </div>
            <p>成熟度建议：{analysis.maturity}。要不要进入生产，由你决定。</p>
          </>
        )}
      </aside>
    </div>
  )
}

function Production({ cardId, onReview }: { cardId: string, onReview: () => void }) {
  const [project, setProject] = useState<ProjectView | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<AssetHit[]>([])

  async function load() {
    const value = await rpc<ProjectView | null>('getProject', { cardId })
    setProject(value)
  }
  useEffect(() => { void load().catch(err => setError(err instanceof Error ? err.message : String(err))) }, [cardId])
  if (error) return <div className="pms-error">{error}</div>
  if (!project?.draft) return <div className="pms-empty">正在组织标题、小标题和可追溯的素材…</div>
  return (
    <div data-testid="production">
      <div className="pms-row">
        <h2 style={{ margin: 0 }}>{project.draft.title}</h2>
        <span className="pms-badge">{project.pages.length} 页，随内容伸缩</span>
        <button className="pms-btn primary" data-testid="enter-review" onClick={onReview}>进入最终审定</button>
      </div>
      <div className="pms-split" style={{ marginTop: 16 }}>
        <section className="pms-col">
          {project.pages.map(page => (
            <article key={page.id} style={{ marginBottom: 16 }}>
              <div className="pms-kicker">{page.kicker} · {page.role}</div>
              <h3>{page.title}</h3>
              {page.blocks.filter(block => block.type === 'paragraph').map(block => <p key={block.id}>{spanText(block.spans, block.text)}</p>)}
              {page.blocks.filter(block => block.type === 'quote').map(block => <blockquote key={block.id}>「{block.text}」</blockquote>)}
            </article>
          ))}
        </section>
        <aside className="pms-panel" data-testid="asset-matching">
          <h3>真实本地素材</h3>
          <p className="pms-sub">建议来自你的素材库，带源文件路径。接受、拒绝或换成另一张，都由你点。</p>
          {project.relations.map(relation => (
            <div key={relation.id} className="pms-asset" data-testid="asset-relation">
              {/\.(png|jpe?g|webp|gif)$/i.test(relation.source_path) ? <img alt="" src={assetUrl(String(relation.asset_id))} /> : <div className="pms-ph" />}
              <div>
                <strong>{relation.status}</strong>
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

function Workbench({ cardId }: { cardId: string }) {
  const [project, setProject] = useState<ProjectView | null>(null)
  const [pages, setPages] = useState<PageModel[]>([])
  const [template, setTemplate] = useState<keyof typeof THEMES>('knowledge')
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

  useEffect(() => {
    void rpc<ProjectView>('getProject', { cardId }).then(value => {
      setProject(value)
      setPages(value.pages)
      if (value.project.template in THEMES) setTemplate(value.project.template as keyof typeof THEMES)
    }).catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [cardId])

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const apply = () => setScale(Math.min(0.72, Math.max(0.28, (node.clientWidth - 24) / 1242)))
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
      void rpc('saveDraft', { draftId: project.draft.id, pages, template }).then(() => setSaved('已自动保存')).catch(err => setSaved(err instanceof Error ? err.message : '保存失败'))
    }, 700)
    return () => window.clearTimeout(handle)
  }, [pages, template])

  const page = pages[current]
  const theme = THEMES[template]
  const versions = useMemo(() => project?.draft.id, [project])

  function updatePage(patch: Partial<PageModel>) {
    commit(pages.map((item, index) => index === current ? { ...item, ...patch } : item))
  }

  if (!project?.draft || !page) return <div className="pms-empty">{error || '正在铺开审定台…'}</div>
  return (
    <div className="pms-workbench" data-testid="workbench">
      <aside className="pms-col pms-thumbs" data-testid="page-list">
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
            onClick={() => setCurrent(index)}
          >
            <strong>{index + 1}. {item.title}</strong>
            <div className="pms-meta">{item.role}</div>
          </button>
        ))}
        <button className="pms-btn" data-testid="add-page" onClick={() => commit([...pages, { id: crypto.randomUUID(), ordinal: pages.length, role: 'content', kicker: '补页', title: '新的一页', blocks: [{ id: crypto.randomUUID(), type: 'paragraph', spans: [{ text: '在这里写下这一页只说一件事。' }] }], style: {} }])}>加一页</button>
        <button className="pms-btn" disabled={pages.length < 2} onClick={() => { const next = pages.filter((_, index) => index !== current); commit(next); setCurrent(Math.max(0, current - 1)) }}>删除此页</button>
      </aside>
      <section className="pms-stage" ref={stageRef} data-testid="page-canvas">
        <div className="pms-canvas-wrap" style={{ transform: `scale(${scale})` }}>
          <article className="pms-page" style={{ background: page.style.background || theme.paper, color: theme.ink, fontFamily: theme.font }}>
            <div className="kicker" style={{ color: page.style.accent || theme.accent }} contentEditable suppressContentEditableWarning onBlur={event => updatePage({ kicker: event.currentTarget.innerText })}>{page.kicker}</div>
            <h2
              style={{ fontSize: page.style.titleSize ?? (page.role === 'cover' ? 84 : 64) }}
              contentEditable
              suppressContentEditableWarning
              data-testid="page-title"
              onBlur={event => updatePage({ title: event.currentTarget.innerText })}
            >{page.title}</h2>
            {page.blocks.map(block => block.type === 'image' ? (
              <figure key={block.id}>
                <img alt={block.caption || ''} src={assetUrl(block.assetId || '')} style={{ objectPosition: `${block.crop?.x ?? 50}% ${block.crop?.y ?? 50}%`, transform: `scale(${block.crop?.scale ?? 1})` }} />
              </figure>
            ) : (
              <EditableBlock key={block.id} block={block} quoteBg={theme.quote} accent={page.style.accent || theme.accent} bodySize={page.style.bodySize ?? 36} onCommit={next => updatePage({ blocks: page.blocks.map(item => item.id === block.id ? next : item) })} />
            ))}
          </article>
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
          <select data-testid="template" value={template} onChange={event => setTemplate(event.target.value as keyof typeof THEMES)}>
            <option value="knowledge">知识分享风</option>
            <option value="tech">科技专业风</option>
            <option value="opinion">个人观点风</option>
          </select>
        </div>
        <div className="pms-field">
          <label>背景</label>
          <input type="color" value={page.style.background || theme.paper} onChange={event => updatePage({ style: { ...page.style, background: event.target.value } })} />
        </div>
        <div className="pms-field">
          <label>强调色</label>
          <input type="color" value={page.style.accent || theme.accent} onChange={event => updatePage({ style: { ...page.style, accent: event.target.value } })} />
        </div>
        <div className="pms-row">
          <button className="pms-btn" onClick={() => document.execCommand('bold')}>加黑</button>
          <button className="pms-btn" onClick={() => document.execCommand('hiliteColor', false, '#ffe08a')}>高亮</button>
        </div>
        {page.blocks.filter(block => block.type === 'image').map(block => (
          <div key={block.id} className="pms-field">
            <label>图片裁切 {block.caption}</label>
            <input type="range" min={0} max={100} value={block.crop?.x ?? 50} onChange={event => updatePage({ blocks: page.blocks.map(item => item.id === block.id ? { ...item, crop: { x: Number(event.target.value), y: item.crop?.y ?? 50, scale: item.crop?.scale ?? 1 } } : item) })} />
            <input type="range" min={0} max={100} value={block.crop?.y ?? 50} onChange={event => updatePage({ blocks: page.blocks.map(item => item.id === block.id ? { ...item, crop: { x: item.crop?.x ?? 50, y: Number(event.target.value), scale: item.crop?.scale ?? 1 } } : item) })} />
            <input type="range" min={100} max={180} value={Math.round((block.crop?.scale ?? 1) * 100)} onChange={event => updatePage({ blocks: page.blocks.map(item => item.id === block.id ? { ...item, crop: { x: item.crop?.x ?? 50, y: item.crop?.y ?? 50, scale: Number(event.target.value) / 100 } } : item) })} />
          </div>
        ))}
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
        <button className="pms-btn primary" data-testid="export" onClick={() => void rpc<{ dir: string }>('exportProject', { cardId }).then(result => setSaved(`已导出 ${result.dir}`)).catch(err => setError(err instanceof Error ? err.message : String(err)))}>导出 1242×1660</button>
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
    const nextBold = bold || node.tagName === 'STRONG' || node.tagName === 'B'
    const nextHighlight = highlight || node.tagName === 'MARK'
    node.childNodes.forEach(child => walk(child, nextBold, nextHighlight))
  }
  walk(root, false, false)
  return spans.length > 0 ? spans : [{ text: root.innerText }]
}
