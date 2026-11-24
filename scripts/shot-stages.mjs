import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const home = process.env.DSH_HOME
const library = process.env.PMS_LIBRARY
const artifacts = process.env.PMS_ARTIFACTS || '/opt/cursor/artifacts'
const port = process.env.PMS_PORT || '47241'
const dsh = process.env.DSH_BIN || 'dsh'
if (!home || !library) {
  console.error('DSH_HOME and PMS_LIBRARY are required')
  process.exit(1)
}
mkdirSync(artifacts, { recursive: true })
const profilePatch = join(home, 'profiles', 'web', 'cordis.patch.yml')
writeFileSync(profilePatch, `# Stage landing screenshots
- id: personal-media-studio
  name: dsh-personal-media-studio
  config:
    libraryProfile: lurenjia
    dataDir: ${JSON.stringify(join(home, 'stage-shots-2'))}
    libraryRoots:
      - ${JSON.stringify(library)}
    exportDir: ${JSON.stringify(join(home, 'stage-exports'))}
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

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PMS_CHROME || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 })
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2000)
  await dismiss(page)
  await page.getByRole('button', { name: '选题', exact: true }).first().click({ timeout: 15000 })
  await page.getByTestId('studio-root').waitFor({ timeout: 30000 })
  await page.getByTestId('stage-nav').waitFor()
  await page.getByTestId('topic-card').first().waitFor({ timeout: 20000 })
  await hideWorkspaceToast(page)
  await shot(page, '08-stage-topics.png')

  await page.getByTestId('topic-card').first().click()
  await page.getByTestId('card-workspace').waitFor()
  await page.getByTestId('thought-input').fill('这张卡先写下一句自己的判断，成熟后再送去改稿。')
  await page.getByRole('button', { name: '追加保存' }).click()
  await page.getByTestId('thought').first().waitFor({ timeout: 10000 })
  await hideWorkspaceToast(page)
  await shot(page, '09-stage-topics-detail.png')

  await page.getByTestId('promote').click()
  await page.getByTestId('text-gate').waitFor({ timeout: 15000 })
  await page.getByTestId('stage-drafts').click()
  await page.getByTestId('draft-center').waitFor()
  await page.getByTestId('draft-row').first().waitFor()
  await hideWorkspaceToast(page)
  await shot(page, '10-stage-drafts.png')

  await page.getByTestId('draft-row').first().click()
  await page.getByTestId('confirm-text').click()
  await page.getByTestId('production').waitFor({ timeout: 20000 })
  await page.getByTestId('draft-structure').waitFor()
  await hideWorkspaceToast(page)
  await shot(page, '11-stage-drafts-detail.png')

  await page.getByTestId('enter-review').click()
  await page.getByTestId('workbench').waitFor({ timeout: 15000 })
  await page.getByTestId('stage-render').click()
  await page.getByTestId('render-center').waitFor()
  await page.getByTestId('render-row').first().waitFor()
  await hideWorkspaceToast(page)
  await shot(page, '12-stage-render.png')

  await page.getByTestId('render-row').first().click()
  await page.getByTestId('workbench').waitFor()
  await page.getByTestId('page-size').waitFor()
  await page.waitForFunction(() => {
    const frame = document.querySelector('[data-testid="brand-frame"]')
    return Boolean(frame && (frame.getAttribute('srcdoc') || '').length > 200)
  }, { timeout: 15000 })
  await hideWorkspaceToast(page)
  await shot(page, '13-stage-render-detail.png')
  const labels = await page.getByTestId('stage-nav').innerText()
  console.log(labels.replace(/\s+/g, ' '))
  console.log('shots ok')
} finally {
  await browser.close().catch(() => {})
  child.kill('SIGTERM')
  await new Promise(resolve => child.on('exit', resolve))
}

function shot(page, name) {
  return page.screenshot({ path: join(artifacts, name) })
}

async function hideWorkspaceToast(page) {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('div, section, p')) {
      const text = node.childNodes.length <= 4 ? node.textContent ?? '' : ''
      if (text.includes('Unable to create default workspace')) node.remove()
    }
  }).catch(() => {})
}

async function dismiss(page) {
  const labels = ['开始使用', '进入', '跳过', '关闭', '知道了', '我知道了', '稍后再说', '同意', '继续', '完成', 'Continue', 'Skip', 'Got it', 'Not now', 'Close']
  for (let round = 0; round < 5; round++) {
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
