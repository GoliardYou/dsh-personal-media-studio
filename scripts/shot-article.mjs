import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const home = process.env.DSH_HOME
const library = process.env.PMS_LIBRARY
const artifacts = process.env.PMS_ARTIFACTS || '/opt/cursor/artifacts'
const port = process.env.PMS_PORT || '47243'
const dsh = process.env.DSH_BIN || 'dsh'
if (!home || !library) {
  console.error('DSH_HOME and PMS_LIBRARY are required')
  process.exit(1)
}
mkdirSync(artifacts, { recursive: true })
writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), `# Article and render screenshots
- id: personal-media-studio
  name: dsh-personal-media-studio
  config:
    libraryProfile: lurenjia
    dataDir: ${JSON.stringify(join(home, 'article-shots-2'))}
    libraryRoots:
      - ${JSON.stringify(library)}
    exportDir: ${JSON.stringify(join(home, 'article-exports'))}
    watch: false
    llm:
      provider: ""
      model: ""
    privacy:
      sendImagesToCloud: false
    brand:
      author: 一个路人甲
      role: 自学面试上岸
    render:
      engine: sharp
      size: standard
      xhsRenderPy: ""
    topicSeed:
      maxCards: 12
`)

const child = spawn(dsh, ['web', '--no-open', '--host', '127.0.0.1', '--port', port], {
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`dsh web did not print a URL\n${log}`)), 120000)
  const onData = chunk => {
    log += chunk.toString()
    const match = log.match(/dsh web: (https?:\/\/\S+)/) || log.match(/(https?:\/\/127\.0\.0\.1:\d+\S*)/)
    if (match) {
      clearTimeout(timer)
      resolve((match[1] || match[0]).replace(/[),]+$/, ''))
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
})

const spoken = [
  '为什么我认为，结构化面试是最重要、最基础的面试方式。我想介绍一下：为什么我觉得结构化面试是最重要、最基础的一种面试方式，以及为什么我推荐所有人，如果有时间的话，都应该学习和训练一下自己的结构化面试能力。',
  '我们讲结构化面试，本意说的是它的出题方式和评价方式是结构化的，能够避免考官随意出题、随意评分。但在实际训练的过程中，我们会发现，我们的回答也应该是结构化的。',
  '结构化表达，是所有面试拿高分的必经之路。无论是什么样的面试，都需要我们进行结构化的表达。没有考官会喜欢一个说话逻辑不清、讲不到重点上的考生。',
  '半结构化面试：自由提问，也要结构化。在自由提问的环节，我们同样应该以结构化表达的方式来输出内容。找到一条答题的基本思路，列出基本的答题点。',
  '「重点是展示，而非说服。」你一开始选择的观点，最后是否成为集体的共识，一点也不重要。',
]

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PMS_CHROME || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 })
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(1800)
  await dismiss(page)
  await page.getByRole('button', { name: '选题', exact: true }).first().click({ timeout: 15000 })
  await page.getByTestId('studio-root').waitFor()
  const cardId = await page.evaluate(async (parts) => {
    const call = async (op, payload) => {
      const response = await fetch('/api/personal-media-studio/rpc', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, payload }),
      })
      const body = await response.json()
      if (!body.ok) throw new Error(body.error?.message || op)
      return body.value
    }
    const created = await call('createCard', { title: '为什么我认为，结构化面试是最重要、最基础的面试方式' })
    const id = created.card.id
    for (const body of parts) await call('appendThought', { cardId: id, body })
    await call('markMature', { cardId: id })
    return id
  }, spoken)
  await page.evaluate(id => { location.hash = `#pms/drafts/${id}` }, cardId)
  await page.getByTestId('article-editor').waitFor({ timeout: 15000 })
  await page.getByTestId('article-md').waitFor()
  await hideToast(page)
  const article = await page.getByTestId('article-md').inputValue()
  if (!article.includes('##') || !article.includes('结构化')) throw new Error(`article was not structured\n${article.slice(0, 400)}`)
  await page.screenshot({ path: join(artifacts, '14-draft-markdown.png') })
  await page.getByRole('button', { name: '定稿，送去渲染' }).click()
  const frame = page.frameLocator('[data-testid="xhs-editor"]')
  await frame.locator('.pv-card').first().waitFor({ timeout: 20000 })
  await hideToast(page)
  await frame.getByRole('button', { name: '头像绿' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(artifacts, '15-render-avatar-green.png') })
  await frame.getByRole('button', { name: '公文风' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(artifacts, '16-render-gongwen.png') })
  console.log('article shots ok', article.slice(0, 180).replace(/\s+/g, ' '))
} finally {
  await browser.close().catch(() => {})
  child.kill('SIGTERM')
  await new Promise(resolve => child.on('exit', resolve))
}

async function hideToast(page) {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('div, section, p')) {
      const text = node.childNodes.length <= 4 ? node.textContent ?? '' : ''
      if (text.includes('Unable to create default workspace')) node.remove()
    }
  }).catch(() => {})
}

async function dismiss(page) {
  const labels = ['开始使用', '进入', '跳过', '关闭', '知道了', '我知道了', '稍后再说', '同意', '继续', '完成', 'Continue', 'Skip', 'Got it', 'Not now', 'Close']
  for (let round = 0; round < 6; round++) {
    let clicked = false
    for (const label of labels) {
      const button = page.getByRole('button', { name: label, exact: false })
      if (await button.count() && await button.first().isVisible().catch(() => false)) {
        await button.first().click().catch(() => {})
        clicked = true
        await page.waitForTimeout(250)
      }
    }
    if (!clicked) break
  }
}
