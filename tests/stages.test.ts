import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { stageOf } from '../src/stages.ts'
import { StudioRuntime } from '../src/runtime.ts'
import type { StudioConfig } from '../src/config.ts'

const dirs: string[] = []
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'pms-stage-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('stage routing', () => {
  it('classifies cards without a schema change', () => {
    expect(stageOf({ status: 'open', maturity: 'seed' })).toBe('topics')
    expect(stageOf({ status: 'shelved', maturity: 'forming' })).toBe('topics')
    expect(stageOf({ status: 'open', maturity: 'mature' })).toBe('drafts')
    expect(stageOf({ status: 'in_production', maturity: 'mature', projectStatus: 'drafting' })).toBe('drafts')
    expect(stageOf({ status: 'open', maturity: 'forming', projectStatus: 'paused' })).toBe('topics')
    expect(stageOf({ status: 'reviewing', maturity: 'mature', projectStatus: 'reviewing' })).toBe('render')
    expect(stageOf({ status: 'exported', maturity: 'mature', projectStatus: 'exported' })).toBe('render')
  })

  it('moves a card forward and back without dropping versions', async () => {
    const dir = temp()
    const studio = await StudioRuntime.open(fakeCtx(), config(dir))
    const id = studio.createCard('慢，是句子').card.id as string
    studio.appendThought(id, '把 40 秒留下来的人，会把它当成早晨的暂停。')
    expect(studio.listStages().counts).toMatchObject({ topics: expect.any(Number), drafts: 0, render: 0 })
    expect(studio.listStages().topics.some(row => row.id === id)).toBe(true)

    studio.markMature(id)
    expect(studio.listStages().drafts.some(row => row.id === id)).toBe(true)
    expect(studio.listStages().topics.some(row => row.id === id)).toBe(false)

    await studio.startProduction(id, studio.issueIntent(id, 'produce'))
    const project = studio.getProject(id)
    expect(project?.draft).toBeTruthy()
    const draftId = String(project!.draft!.id)
    studio.saveDraft(draftId, { title: '慢，是句子', pages: project!.pages })
    expect(studio.getCard(id).card.status).toBe('in_production')
    expect(studio.listStages().render.some(row => row.id === id)).toBe(false)

    const before = versionCount(studio, draftId)
    studio.confirmForRender(id)
    const sent = versionCount(studio, draftId)
    expect(sent).toBe(before + 1)
    expect(studio.listStages().render.some(row => row.id === id)).toBe(true)

    studio.returnToDrafts(id)
    expect(versionCount(studio, draftId)).toBe(sent)
    expect(studio.getCard(id).card.status).toBe('in_production')
    expect(studio.listStages().drafts.some(row => row.id === id)).toBe(true)
    expect(studio.getProject(id)?.pages.length).toBe(project!.pages.length)

    studio.returnToTopics(id)
    expect(versionCount(studio, draftId)).toBe(sent)
    expect(studio.listStages().topics.some(row => row.id === id)).toBe(true)
    studio.markMature(id)
    expect(studio.listStages().drafts.some(row => row.id === id)).toBe(true)
    expect(studio.getProject(id)?.pages.length).toBe(project!.pages.length)
    await studio.dispose()
  })
})

function versionCount(studio: StudioRuntime, draftId: string) {
  return (studio.db.db.prepare(`SELECT COUNT(*) AS n FROM versions WHERE draft_id = ?`).get(draftId) as { n: number }).n
}

function fakeCtx() {
  return { llm: { listProviders: () => [], stream: async function* () {} } } as unknown as Context
}

function config(dir: string): StudioConfig {
  return {
    dataDir: join(dir, 'data'),
    libraryRoots: [],
    libraryProfile: 'generic',
    knowledgeDir: '',
    excludeGlobs: [],
    exportDir: join(dir, 'exports'),
    watch: false,
    llm: { provider: '', model: '' },
    privacy: { sendImagesToCloud: false },
    ocr: { command: '' },
    brand: { author: '一个路人甲', role: '自学面试上岸' },
    render: { engine: 'sharp', size: 'standard', xhsRenderPy: '' },
    topicSeed: { maxCards: 12 },
  }
}
