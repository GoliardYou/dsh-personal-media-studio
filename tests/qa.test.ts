import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { Context } from '@deepseek-ai/cordis'
import { clusterQuestions, formatClusterBody, markPublished, selectBoard, type QaNote } from '../src/qa/cluster.ts'
import { isQaMarkdown, parseQaMarkdown } from '../src/qa/parse.ts'
import { StudioRuntime } from '../src/runtime.ts'
import type { StudioConfig } from '../src/config.ts'
import { uid } from '../src/util.ts'

const dirs: string[] = []
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'pms-qa-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SAMPLE = `---
# 如何制作归纳卡片
---
## 原始问题
老师可以举个例子嘛，比如像这个您会怎么制作卡片呢😭
---
## 回答
你这个原始材料逻辑有点糟糕，先把结论写成一句，再把例子收成三行。
---
## 元信息
- **创建时间**: 2026-03-07 05:08:40
- **来源文件**: Screenshot_card.jpg
---
`

describe('Xhs_QA parser', () => {
  it('reads the H1, the question, the answer, the time, and the screenshot name', () => {
    const parsed = parseQaMarkdown(SAMPLE)
    expect(parsed).toMatchObject({
      title: '如何制作归纳卡片',
      question: '老师可以举个例子嘛，比如像这个您会怎么制作卡片呢😭',
      answer: '你这个原始材料逻辑有点糟糕，先把结论写成一句，再把例子收成三行。',
      createdAt: '2026-03-07 05:08:40',
      sourceFile: 'Screenshot_card.jpg',
    })
  })

  it('only accepts markdown notes, never backup, images, or tables', () => {
    expect(isQaMarkdown('Xhs_QA_小红书问答/markdown/如何制作归纳卡片.md')).toBe(true)
    expect(isQaMarkdown('Xhs_QA_小红书问答/backup/如何制作归纳卡片.md')).toBe(false)
    expect(isQaMarkdown('Xhs_QA_小红书问答/images/01感谢_自学_面试_粉丝_创造.jpg')).toBe(false)
    expect(isQaMarkdown('Xhs_QA_小红书问答/images/说明.md')).toBe(false)
    expect(isQaMarkdown('Xhs_QA_小红书问答/问答.xlsx')).toBe(false)
    expect(isQaMarkdown('Xhs_QA_小红书问答/导出.csv')).toBe(false)
    expect(isQaMarkdown('Xhs_QA_小红书问答/index.db')).toBe(false)
    expect(isQaMarkdown('Xhs_QA_小红书问答/map.json')).toBe(false)
    expect(isQaMarkdown('notes/别的笔记.md')).toBe(false)
  })
})

describe('theme clustering', () => {
  const now = Date.parse('2026-11-24T00:00:00Z')

  it('merges near-duplicates, caps the board, and parks published themes', () => {
    const notes = [
      ...paraphrases('card', '如何制作归纳卡片', '老师可以举个例子嘛，比如像这个您会怎么制作卡片呢', '先把结论写成一句。', 6, '2026-11-01'),
      ...paraphrases('card-dup', '如何制作归纳卡片', '老师可以举个例子嘛，比如像这个您会怎么制作卡片呢😭', '先把结论写成一句。', 2, '2026-11-02'),
      ...paraphrases('template', '结构化面试是不是背模板', '答题能不能把稿子背下来', '模板是骨架，句子得是你自己的。', 5, '2026-10-01'),
      ...paraphrases('analysis', '综合分析怎么找角度', '综合分析题总是在堆材料', '先说一句判断，再给两个例子。', 4, '2026-09-01'),
      ...paraphrases('time', '答题时间不够怎么办', '还有三十秒的时候怎么收', '先把结论说完，例子只留一个。', 3, '2026-08-01'),
      ...paraphrases('intro', '自我介绍怎么开头', '自我介绍是不是也要背下来', '用一件你做过的事开头。', 4, '2026-11-20'),
      ...paraphrases('plan', '计划组织题怎么搭结构', '计划组织题的第一步写什么', '先确认人和时间，再排步骤。', 2, '2026-07-01'),
      ...paraphrases('once', '漫画题要不要描述画面', '漫画题是先描述再点题吗', '用一句话点出矛盾。', 1, '2026-06-01'),
    ]
    const clusters = clusterQuestions(notes, now)
    markPublished(clusters, ['自我介绍怎么开头'])
    const picked = selectBoard(clusters, 3)
    expect(clusters.reduce((sum, cluster) => sum + cluster.members.length, 0)).toBe(notes.length)
    expect(picked.board.length).toBeLessThanOrEqual(3)
    expect(picked.board.some(cluster => cluster.title.includes('自我介绍'))).toBe(false)
    expect(picked.pool.some(cluster => cluster.title.includes('自我介绍'))).toBe(true)
    const card = clusters.find(cluster => cluster.members.some(note => note.id.startsWith('card')))
    const dup = card?.members.filter(note => note.id.startsWith('card'))
    expect(dup?.length).toBe(8)
    expect(card && formatClusterBody(card)).toContain('已有回答：')
    expect(card && formatClusterBody(card)).toContain('8 位同学')
    expect(picked.board.every(cluster => !/_/.test(cluster.title))).toBe(true)
    expect(picked.board[0].members.length).toBeGreaterThanOrEqual(picked.board.at(-1)!.members.length - 4)
  })

  it('keeps 526 notes inside the default cap and reports the theme shape', () => {
    const themes = [
      ['归纳卡片', '如何制作归纳卡片', '这种材料要怎么制作成归纳卡片'],
      ['背模板', '结构化面试是不是背模板', '答题能不能把稿子背下来'],
      ['自我介绍', '自我介绍怎么开头', '开场要不要先报姓名和岗位'],
      ['综合分析', '综合分析怎么找角度', '材料很多的时候怎么下判断'],
      ['计划组织', '计划组织题怎么搭结构', '活动方案的第一步写什么'],
      ['应急应变', '应急应变题先处理什么', '现场突然出错要先安抚谁'],
      ['人际沟通', '人际沟通题怎么劝', '同事不配合的时候怎么开口'],
      ['名言警句', '名言警句题怎么用', '领导的一句话要不要展开'],
      ['时政热点', '时政热点要怎么接到岗位', '新闻事件怎么收成自己的判断'],
      ['答题时间', '答题时间不够怎么办', '还有三十秒怎么把结论说完'],
      ['口头禅', '口头禅会不会扣分', '总说然后和嗯怎么改'],
      ['看考官', '答题时要不要抬头看考官', '眼睛一直看桌子会不会减分'],
      ['紧张忘词', '一紧张就忘词怎么办', '脑子空白的那几秒怎么接'],
      ['岗位匹配', '岗位匹配题怎么证明', '为什么报这个岗位才像你'],
      ['漫画题', '漫画题要不要描述画面', '先描述再点题会不会超时'],
      ['情景模拟', '情景模拟要不要入戏', '模拟对话的第一句怎么起'],
      ['社会现象', '社会现象题怎么表态', '看到一个现象先反对还是先理解'],
      ['哲理故事', '哲理故事题怎么落回自己', '故事讲完怎么接到岗位'],
      ['调研提纲', '调研提纲要列多细', '下乡调研先问哪三个问题'],
      ['演讲开场', '演讲开场怎么不念稿', '一上台的第一句说什么'],
      ['反驳考官', '考官反驳时要不要认', '被追问的时候怎么把判断守住'],
      ['归纳总结', '最后三十秒怎么归纳总结', '收尾是再讲一遍还是只留一句'],
    ] as const
    const counts = [50, 46, 44, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 40, 28, 22, 16, 12, 10, 8, 8]
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(526)
    const notes: QaNote[] = []
    themes.forEach((theme, themeIndex) => {
      const count = counts[themeIndex]
      for (let index = 0; index < count; index++) {
        const day = String((index % 27) + 1).padStart(2, '0')
        const month = String((themeIndex % 11) + 1).padStart(2, '0')
        notes.push(makeNote({
          id: `${theme[0]}-${index}`,
          title: theme[1],
          question: `${theme[2]}${index % 5 === 0 ? '😭' : ''}`,
          answer: `围绕「${theme[0]}」先给一句判断，再留一个你自己的例子。`,
          createdAt: `2026-${month}-${day} 08:00:00`,
          sourceFile: `Screenshot_${theme[0]}.jpg`,
        }))
      }
    })
    const clusters = clusterQuestions(notes, now)
    markPublished(clusters, ['如何制作归纳卡片'])
    const picked = selectBoard(clusters, 12)
    const majority = new Map<string, string>()
    for (const theme of themes) {
      const own = notes.filter(note => note.id.startsWith(`${theme[0]}-`))
      const tally = new Map<string, number>()
      for (const note of own) {
        const key = clusters.find(cluster => cluster.members.includes(note))?.key ?? ''
        tally.set(key, (tally.get(key) ?? 0) + 1)
      }
      const [key, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
      expect(count / own.length).toBeGreaterThanOrEqual(0.8)
      majority.set(theme[0], key)
    }
    const keys = [...majority.values()]
    expect(new Set(keys).size).toBe(keys.length)
    expect(picked.board).toHaveLength(12)
    expect(picked.board.some(cluster => cluster.published || cluster.title.includes('如何制作归纳卡片'))).toBe(false)
    expect(picked.pool.some(cluster => cluster.title.includes('如何制作归纳卡片'))).toBe(true)
    expect(clusters).toHaveLength(22)
    expect(picked.pool).toHaveLength(10)
    expect(clusters.reduce((sum, cluster) => sum + cluster.members.length, 0)).toBe(526)
    const boardAsks = picked.board.reduce((sum, cluster) => sum + cluster.members.length, 0)
    expect(boardAsks).toBeGreaterThan(picked.pool.filter(cluster => !cluster.published).reduce((sum, cluster) => sum + cluster.members.length, 0) / 4)
  })
})

describe('legacy seed cleanup', () => {
  it('drops untouched filename cards and keeps every card the user touched', async () => {
    const dir = temp()
    const library = join(dir, 'library')
    const markdown = join(library, 'Xhs_QA_小红书问答', 'markdown')
    const images = join(library, 'Xhs_QA_小红书问答', 'images')
    mkdirSync(markdown, { recursive: true })
    mkdirSync(images, { recursive: true })
    mkdirSync(join(library, 'Xhs_QA_小红书问答', 'backup'), { recursive: true })
    writeFileSync(join(markdown, '卡片.md'), SAMPLE)
    writeFileSync(join(markdown, '卡片-再问.md'), SAMPLE.replace('05:08:40', '05:09:40').replace('老师可以举个例子嘛，比如像这个您会怎么制作卡片呢😭', '老师可以举个例子嘛，比如像这个您会怎么制作卡片呢'))
    writeFileSync(join(library, 'Xhs_QA_小红书问答', 'backup', '旧问题.md'), SAMPLE.replace('如何制作归纳卡片', '备份里的旧问题'))
    writeFileSync(join(library, 'Xhs_QA_小红书问答', '问答.xlsx'), 'not markdown')
    await sharp({ create: { width: 12, height: 12, channels: 3, background: '#336699' } }).jpeg().toFile(join(images, 'Screenshot_card.jpg'))
    await sharp({ create: { width: 12, height: 12, channels: 3, background: '#993333' } }).jpeg().toFile(join(images, '01感谢_自学_面试_粉丝_创造.jpg'))
    const studio = await openStudio(dir, library, 2)
    const titles = () => studio.listCards().map(card => String((card as { title?: string }).title))
    expect(titles().some(title => title.includes('_'))).toBe(false)
    expect(titles().some(title => title.includes('备份'))).toBe(false)
    expect(titles()).toEqual(['如何制作归纳卡片'])
    const linked = studio.db.db.prepare(`SELECT source_asset_id, source_file FROM qa_items WHERE source_file = ?`).get('Screenshot_card.jpg') as { source_asset_id: string | null, source_file: string }
    expect(linked.source_file).toBe('Screenshot_card.jpg')
    expect(linked.source_asset_id).toBeTruthy()
    const body = String((studio.listCards()[0] as { latestThesis?: string }).latestThesis)
    expect(body).toContain('2 位同学')
    expect(body).toContain('已有回答：')
    expect((studio.db.db.prepare(`SELECT COUNT(*) AS n FROM topics WHERE placement = 'pool'`).get() as { n: number }).n).toBe(0)

    const root = library
    const stamp = new Date().toISOString()
    const insertAsset = (title: string) => {
      studio.db.db.prepare(`
        INSERT INTO assets(id, root, rel_path, abs_path, sha256, mime, kind, bytes, title, text_content, mtime_ms, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'image/jpeg', 'image', 10, ?, '', 1, ?, ?)
      `).run(uid(), root, `Xhs_QA_小红书问答/images/${title}.jpg`, join(images, `${title}.jpg`), uid(), title, stamp, stamp)
    }
    const insertLegacy = (title: string) => {
      const topicId = uid()
      const cardId = uid()
      studio.db.db.prepare(`INSERT INTO topics(id, title, summary, source, created_at, updated_at) VALUES (?, ?, '旧种子', 'ai', ?, ?)`).run(topicId, title, stamp, stamp)
      studio.db.db.prepare(`INSERT INTO cards(id, topic_id, title, status, maturity, input_version, source, created_at, updated_at) VALUES (?, ?, ?, 'open', 'seed', 0, 'ai', ?, ?)`).run(cardId, topicId, title, stamp, stamp)
      return cardId
    }
    insertLegacy('01感谢_自学_面试_粉丝_创造')
    for (const title of ['用户改过的题', '改过版本的题', '已有项目的题', '有分析的题', '搁置过的题', '为什么我愿意为「慢」付钱']) insertAsset(title)
    const edited = insertLegacy('用户改过的题')
    studio.db.db.prepare(`INSERT INTO interactions(id, card_id, kind, body, created_at) VALUES (?, ?, 'thought', '这句我要留着', ?)`).run(uid(), edited, stamp)
    const versioned = insertLegacy('改过版本的题')
    studio.db.db.prepare(`UPDATE cards SET input_version = 1 WHERE id = ?`).run(versioned)
    const projected = insertLegacy('已有项目的题')
    studio.db.db.prepare(`INSERT INTO projects(id, card_id, status, template, created_at, updated_at) VALUES (?, ?, 'draft', 'avatar-green', ?, ?)`).run(uid(), projected, stamp, stamp)
    const analyzed = insertLegacy('有分析的题')
    studio.db.db.prepare(`INSERT INTO ai_analyses(id, card_id, input_version, engine, maturity, created_at) VALUES (?, ?, 0, 'heuristic', 'seed', ?)`).run(uid(), analyzed, stamp)
    const shelved = insertLegacy('搁置过的题')
    studio.db.db.prepare(`UPDATE cards SET status = 'shelved' WHERE id = ?`).run(shelved)
    const recommended = insertLegacy('为什么我愿意为「慢」付钱')
    const mine = studio.createCard('我自己的卡')
    studio.seedTopics()
    const left = new Set(titles())
    expect(left.has('01感谢_自学_面试_粉丝_创造')).toBe(false)
    expect(left.has('用户改过的题')).toBe(true)
    expect(left.has('改过版本的题')).toBe(true)
    expect(left.has('已有项目的题')).toBe(true)
    expect(left.has('有分析的题')).toBe(true)
    expect(left.has('搁置过的题')).toBe(true)
    expect(left.has('为什么我愿意为「慢」付钱')).toBe(true)
    expect(left.has('我自己的卡')).toBe(true)
    expect(left.has('如何制作归纳卡片')).toBe(true)
    expect(studio.db.db.prepare(`SELECT id FROM cards WHERE id = ?`).get(recommended)).toBeTruthy()
    expect(studio.db.db.prepare(`SELECT source FROM topics WHERE title = ?`).get('用户改过的题')).toBeTruthy()
    expect(mine.card.id).toBeTruthy()
    const again = (studio.db.db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE deleted_at IS NULL`).get() as { n: number }).n
    studio.seedTopics()
    expect((studio.db.db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE deleted_at IS NULL`).get() as { n: number }).n).toBe(again)
    await studio.dispose()
  })
})

function paraphrases(id: string, title: string, question: string, answer: string, count: number, day: string): QaNote[] {
  return Array.from({ length: count }, (_, index) => makeNote({
    id: `${id}-${index}`,
    title,
    question: index === 0 ? question : `${question}，再讲一次`,
    answer,
    createdAt: `${day} 0${index % 9}:00:00`,
    sourceFile: `Screenshot_${id}.jpg`,
  }))
}

function makeNote(partial: Omit<QaNote, 'assetId' | 'relPath' | 'sourceAssetId'> & { id: string }): QaNote {
  return {
    assetId: partial.id,
    relPath: `Xhs_QA_小红书问答/markdown/${partial.id}.md`,
    sourceAssetId: null,
    ...partial,
  }
}

function config(dir: string, library: string, maxCards: number): StudioConfig {
  return {
    dataDir: join(dir, 'data'),
    libraryRoots: [library],
    libraryProfile: 'lurenjia',
    knowledgeDir: '',
    excludeGlobs: ['**/.git/**'],
    exportDir: join(dir, 'exports'),
    watch: false,
    llm: { provider: '', model: '' },
    privacy: { sendImagesToCloud: false },
    ocr: { command: '' },
    brand: { author: '一个路人甲', role: '自学面试上岸' },
    render: { engine: 'sharp', size: 'standard', xhsRenderPy: '' },
    topicSeed: { maxCards },
  }
}

async function openStudio(dir: string, library: string, maxCards: number) {
  const ctx = { llm: { listProviders: () => [], stream: async function* () {} } } as unknown as Context
  return StudioRuntime.open(ctx, config(dir, library, maxCards))
}
