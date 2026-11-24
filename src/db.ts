import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIGRATION = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  abs_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  thumb_path TEXT,
  title TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  mtime_ms INTEGER NOT NULL,
  ocr_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(root, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_assets_sha ON assets(sha256);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);

CREATE TABLE IF NOT EXISTS asset_chunks (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (asset_id, tag)
);

CREATE TABLE IF NOT EXISTS asset_embeddings (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  chunk_id TEXT,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  topic_id TEXT REFERENCES topics(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  maturity TEXT NOT NULL DEFAULT 'seed',
  input_version INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  input_version INTEGER NOT NULL,
  engine TEXT NOT NULL,
  thesis TEXT NOT NULL DEFAULT '',
  stories_json TEXT NOT NULL DEFAULT '[]',
  gaps_json TEXT NOT NULL DEFAULT '[]',
  perspectives_json TEXT NOT NULL DEFAULT '[]',
  related_assets_json TEXT NOT NULL DEFAULT '[]',
  maturity TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  analysis_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  card_id TEXT,
  input_version INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL,
  locked_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, run_after);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  status TEXT NOT NULL,
  template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  structure_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_pages (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  blocks_json TEXT NOT NULL,
  style_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS asset_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  draft_page_id TEXT,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  status TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL,
  crop_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS style_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  tokens_json TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_id TEXT,
  dir TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  body,
  tokenize = 'trigram'
);
`

export class StudioDb {
  readonly db: DatabaseSync

  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    this.db.exec(MIGRATION)
    this.markMigration()
    this.seedStyles()
  }

  private markMigration() {
    this.mark(1)
    const columns = new Set((this.db.prepare(`PRAGMA table_info(topics)`).all() as Array<{ name: string }>).map(column => column.name))
    if (!columns.has('placement')) this.db.exec(`ALTER TABLE topics ADD COLUMN placement TEXT NOT NULL DEFAULT 'board'`)
    if (!columns.has('ask_count')) this.db.exec(`ALTER TABLE topics ADD COLUMN ask_count INTEGER NOT NULL DEFAULT 0`)
    if (!columns.has('cluster_key')) this.db.exec(`ALTER TABLE topics ADD COLUMN cluster_key TEXT NOT NULL DEFAULT ''`)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS qa_items (
        id TEXT PRIMARY KEY,
        asset_id TEXT,
        source_asset_id TEXT,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at_src TEXT NOT NULL DEFAULT '',
        source_file TEXT NOT NULL DEFAULT '',
        rel_path TEXT NOT NULL,
        cluster_key TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_qa_items_cluster ON qa_items(cluster_key);
    `)
    this.mark(2)
    const projectColumns = new Set((this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>).map(column => column.name))
    if (!projectColumns.has('page_size')) this.db.exec(`ALTER TABLE projects ADD COLUMN page_size TEXT NOT NULL DEFAULT 'standard'`)
    this.mark(3)
    // 幂等键：推进操作带 client_op_id，网络重试不会重复追加原话。
    const interactionColumns = new Set((this.db.prepare(`PRAGMA table_info(interactions)`).all() as Array<{ name: string }>).map(column => column.name))
    if (!interactionColumns.has('client_op_id')) this.db.exec(`ALTER TABLE interactions ADD COLUMN client_op_id TEXT`)
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_client_op ON interactions(client_op_id) WHERE client_op_id IS NOT NULL`)
    // 原话可编辑：保留首次写入时间，另记最后一次编辑时间；不覆盖、不丢历史版本。
    const editableColumns = new Set((this.db.prepare(`PRAGMA table_info(interactions)`).all() as Array<{ name: string }>).map(column => column.name))
    if (!editableColumns.has('edited_at')) this.db.exec(`ALTER TABLE interactions ADD COLUMN edited_at TEXT`)
    this.mark(4)
    // 灵感收件箱：来源、原始条目、待作者判断的候选。条目只存引用和原文，
    // 不复制素材库文件；候选通过后才创建选题卡。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inspiration_sources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        last_sync_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inspiration_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES inspiration_sources(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        provenance TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inspiration_items_source ON inspiration_items(source_id, captured_at);
      CREATE TABLE IF NOT EXISTS inspiration_candidates (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES inspiration_items(id) ON DELETE CASCADE,
        angle TEXT NOT NULL,
        why TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        card_id TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_inspiration_candidates_status ON inspiration_candidates(status, created_at);
    `)
    this.seedInspirationSources()
    this.mark(5)
  }

  private seedInspirationSources() {
    const stamp = new Date().toISOString()
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO inspiration_sources(id, kind, name, status, detail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const sources = [
      ['manual', 'manual', '手动收件箱', 'connected', '你贴进来的句子、链接和想法'],
      ['agent', 'agent', '助手提议', 'connected', '灵感助手收进来的候选；仍要你判断'],
      ['library', 'library', '素材库', 'not_connected', '只读索引；尚未接入本地素材库'],
      ['qianfan-notes', 'qianfan', '千帆 · 互动', 'not_connected', '帖子曝光、观看、收藏、评论'],
      ['qianfan-orders', 'qianfan', '千帆 · 交易', 'not_connected', '订单、退款、客单'],
    ] as const
    for (const [id, kind, name, status, detail] of sources) insert.run(id, kind, name, status, detail, stamp, stamp)
  }

  private mark(version: number) {
    const row = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version) as { version: number } | undefined
    if (!row) this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
  }

  private seedStyles() {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM style_profiles').get() as { n: number }
    if (count.n > 0) return
    const insert = this.db.prepare('INSERT INTO style_profiles(id, name, template, tokens_json, builtin) VALUES (?, ?, ?, ?, 1)')
    const styles = [
      ['avatar-green', '头像绿', 'avatar-green', { paper: '#F5F6F0', ink: '#34906C', accent: '#D4A54A' }],
      ['navy-gold', '深蓝金', 'navy-gold', { paper: '#F6F1E8', ink: '#173A52', accent: '#B8903A' }],
      ['gongwen', '公文风', 'gongwen', { paper: '#FFFFFF', ink: '#000000', accent: '#000000' }],
    ] as const
    for (const [id, name, template, tokens] of styles) insert.run(id, name, template, JSON.stringify(tokens))
  }

  tx(fn: () => void) {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  indexText(entityType: string, entityId: string, body: string) {
    this.db.prepare('DELETE FROM content_fts WHERE entity_id = ? AND entity_type = ?').run(entityId, entityType)
    const text = body.replace(/\s+/g, ' ').trim()
    if (!text) return
    this.db.prepare('INSERT INTO content_fts(entity_type, entity_id, body) VALUES (?, ?, ?)').run(entityType, entityId, text)
  }

  searchText(query: string, limit = 20): Array<{ entity_type: string, entity_id: string, snippet: string }> {
    const q = query.trim()
    if (!q) return []
    const chars = Array.from(q).length
    if (chars < 3) {
      return this.db.prepare(
        `SELECT entity_type, entity_id, substr(body, 1, 80) AS snippet
         FROM content_fts WHERE body LIKE ? LIMIT ?`,
      ).all(`%${q.replace(/[%_]/g, '')}%`, limit) as Array<{ entity_type: string, entity_id: string, snippet: string }>
    }
    const phrase = `"${q.replace(/"/g, ' ')}"`
    try {
      return this.db.prepare(
        `SELECT entity_type, entity_id, snippet(content_fts, 2, '', '', '…', 16) AS snippet
         FROM content_fts WHERE content_fts MATCH ? LIMIT ?`,
      ).all(phrase, limit) as Array<{ entity_type: string, entity_id: string, snippet: string }>
    } catch {
      return this.db.prepare(
        `SELECT entity_type, entity_id, substr(body, 1, 80) AS snippet
         FROM content_fts WHERE body LIKE ? LIMIT ?`,
      ).all(`%${q}%`, limit) as Array<{ entity_type: string, entity_id: string, snippet: string }>
    }
  }

  backup(dest: string) {
    mkdirSync(dirname(dest), { recursive: true })
    // node:sqlite has no serialize(); VACUUM INTO writes a consistent snapshot
    // while the database stays open (and replaces any stale file).
    rmSync(dest, { force: true })
    this.db.prepare(`VACUUM INTO ?`).run(dest)
  }

  close() {
    this.db.close()
  }
}
