import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const repo = new URL('..', import.meta.url).pathname
const home = process.env.DSH_HOME
const library = process.env.PMS_LIBRARY
const artifacts = process.env.PMS_ARTIFACTS || '/opt/cursor/artifacts'
const port = process.env.PMS_PORT || '47221'
const dsh = process.env.DSH_BIN || 'dsh'

if (!home || !library) {
  console.error('DSH_HOME and PMS_LIBRARY are required')
  process.exit(1)
}
mkdirSync(artifacts, { recursive: true })

const profilePatch = join(home, 'profiles', 'web', 'cordis.patch.yml')
const override = `- id: personal-media-studio
  name: dsh-personal-media-studio
  config:
    libraryProfile: lurenjia
    dataDir: ${JSON.stringify(join(home, 'personal-media-studio'))}
    libraryRoots:
      - ${JSON.stringify(library)}
    exportDir: ${JSON.stringify(join(home, 'exports'))}
    watch: false
    llm:
      provider: ""
      model: ""
    privacy:
      sendImagesToCloud: false
    ocr:
      command: ""
    brand:
      author: 一个路人甲
      role: 自学面试上岸
    render:
      engine: auto
      size: standard
      xhsRenderPy: ""
`
const header = `# Profile patch for the Personal Media Studio verification profile.
`
writeFileSync(profilePatch, `${header}${override}\n`)

const child = spawn(dsh, ['web', '--no-open', '--host', '127.0.0.1', '--port', port], {
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const urlPromise = new Promise((resolve, reject) => {
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
  child.on('exit', code => {
    if (code) reject(new Error(`dsh exited ${code}\n${log}`))
  })
})

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PMS_CHROME || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('console', msg => {
  if (msg.type() === 'error') console.log('BROWSER', msg.text())
})

try {
  const url = await urlPromise
  console.log('URL', url)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2500)
  console.log('BODY', (await page.locator('body').innerText()).slice(0, 1800))
  await dismissOverlays(page)
  const openStudio = page.getByRole('button', { name: '选题' })
  await openStudio.first().click({ timeout: 15000 })
  await page.getByTestId('studio-root').waitFor({ timeout: 30000 })
  await page.getByTestId('topic-card').first().waitFor()
  await page.getByText('Unable to create default workspace').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {})
  await page.screenshot({ path: join(artifacts, '01-dsh-workbench-topics.png') })

  const titles = await page.getByTestId('topic-card').allInnerTexts()
  console.log('cards', titles.map(text => text.replace(/\s+/g, ' ').slice(0, 80)))
  const targetCard = page.getByTestId('topic-card').filter({ hasText: '差评' }).first()
  await targetCard.click()
  await page.getByTestId('card-workspace').waitFor()
  const thought = '我认为澄白便携咖啡机值得被写成一条判断。例如评论区有一条差评原话：看着好看，出水太慢，赶时间根本没用。但是把这 40 秒留下来的人，会把它当成早晨的暂停。慢在这里不是参数，是这台机器的句子。'
  await page.getByTestId('thought-input').fill(thought)
  await page.getByRole('button', { name: '关联本地素材' }).click()
  await page.waitForTimeout(400)
  const boxes = page.locator('input[type="checkbox"]')
  if (await boxes.count()) await boxes.first().check()
  await page.getByTestId('shelve').click()
  await page.getByTestId('topic-center').waitFor()
  await page.getByTestId('topic-card').filter({ hasText: '金句' }).first().click()
  await page.getByTestId('card-workspace').waitFor()
  await page.getByRole('button', { name: '返回选题' }).click()
  await page.getByTestId('topic-card').filter({ hasText: '差评' }).first().click()
  try {
    await page.getByTestId('analysis-thesis').waitFor({ timeout: 20000 })
  } catch (error) {
    console.log('PANEL', await page.getByTestId('analysis-panel').innerText())
    throw error
  }
  const questions = await page.getByTestId('questions').innerText()
  await page.getByTestId('thought-input').fill('再补一个画面：酒店窗边，杯子先被温热。')
  await page.getByRole('button', { name: '追加保存' }).click()
  await page.waitForTimeout(1800)
  const questionsAfter = await page.getByTestId('questions').innerText()
  console.log('questions changed', questions !== questionsAfter, questionsAfter.slice(0, 80))

  await page.getByTestId('new-card').click().catch(() => {})
  // delete/undo uses the current card only after we leave it; create via the home instead
  await page.getByRole('button', { name: '返回选题' }).click()
  await page.getByTestId('new-card').click()
  await page.getByLabel('选题标题').fill('临时卡片')
  await page.getByRole('button', { name: '创建' }).click()
  await page.getByTestId('delete-card').click()
  await page.getByTestId('undo-toast').waitFor()
  await page.getByRole('button', { name: '撤销' }).click()
  await page.getByText('临时卡片').waitFor()

  await page.getByTestId('topic-card').filter({ hasText: '差评' }).first().click()
  await page.getByTestId('promote').click()
  await page.getByTestId('text-gate').waitFor({ timeout: 15000 })
  await page.screenshot({ path: join(artifacts, '02-card-workspace-ai-analysis.png') })
  await page.getByTestId('confirm-text').click()
  await page.getByTestId('production').waitFor({ timeout: 20000 })
  await page.getByTestId('asset-relation').first().waitFor()
  await page.getByTestId('accept-asset').first().click()
  await page.screenshot({ path: join(artifacts, '03-production-asset-matching.png') })
  await page.getByTestId('enter-review').click()
  await page.getByTestId('workbench').waitFor()
  const title = page.getByTestId('page-title')
  await title.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('慢，是这台机器的句子')
  await page.keyboard.press('Tab')
  await page.getByTestId('template').selectOption('avatar-green')
  await page.getByTestId('save-state').filter({ hasText: '已自动保存' }).waitFor({ timeout: 8000 })
  await page.getByTestId('add-page').click()
  await page.getByRole('button', { name: '撤销' }).click()
  await page.screenshot({ path: join(artifacts, '04-wysiwyg-review-workbench.png') })
  await page.getByTestId('save-state').filter({ hasText: '已自动保存' }).waitFor({ timeout: 8000 })
  await page.getByTestId('export').click()
  await page.getByText(/已导出/).waitFor({ timeout: 60000 })
  const exportRoot = join(home, 'exports')
  const pngs = findPngs(exportRoot)
  console.log('pngs', pngs)
  if (pngs.length < 2) throw new Error('expected at least two exported pages')
  const { copyFileSync } = await import('node:fs')
  const cover = pngs.find(file => file.endsWith('01-cover.png')) ?? pngs[0]
  const contentPages = pngs.filter(file => file.includes('content')).sort((a, b) => statSync(b).size - statSync(a).size)
  copyFileSync(cover, join(artifacts, '05-exported-page-cover.png'))
  copyFileSync(contentPages[0] ?? pngs[1], join(artifacts, '06-exported-page-content.png'))
  console.log('journey ok', { questions: questionsAfter.slice(0, 60) })
} finally {
  await browser.close().catch(() => {})
  child.kill('SIGTERM')
  await new Promise(resolve => child.on('exit', resolve))
}

async function dismissOverlays(page) {
  const labels = ['开始使用', '进入', '跳过', '关闭', '知道了', '我知道了', '稍后再说', '以后再说', '同意', '继续', '完成', 'Continue', 'Skip', 'Got it', 'Not now', 'Close']
  for (let round = 0; round < 5; round++) {
    let clicked = false
    for (const label of labels) {
      const button = page.getByRole('button', { name: label, exact: false })
      if (await button.count() && await button.first().isVisible().catch(() => false)) {
        await button.first().click().catch(() => {})
        clicked = true
        await page.waitForTimeout(300)
      }
    }
    const dialog = page.getByRole('dialog')
    if (await dialog.count()) {
      await page.keyboard.press('Escape').catch(() => {})
      clicked = true
    }
    if (!clicked) break
  }
}

function findPngs(dir) {
  const out = []
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.png') && statSync(full).size > 1000) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}
