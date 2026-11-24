import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { chromium } from 'playwright'

const home = process.env.DSH_HOME
const artifacts = process.env.PMS_ARTIFACTS || '/opt/cursor/artifacts'
const port = process.env.PMS_PORT || '47237'
const dsh = process.env.DSH_BIN || 'dsh'
const library = process.env.PMS_LIBRARY || join('/tmp', 'pms-qa-board')
if (!home) {
  console.error('DSH_HOME is required')
  process.exit(1)
}

await writeSampleLibrary(library)
const profilePatch = join(home, 'profiles', 'web', 'cordis.patch.yml')
writeFileSync(profilePatch, `# QA topic board screenshot
- id: personal-media-studio
  name: dsh-personal-media-studio
  config:
    libraryProfile: lurenjia
    dataDir: ${JSON.stringify(join(home, 'qa-topic-board'))}
    libraryRoots:
      - ${JSON.stringify(library)}
    exportDir: ${JSON.stringify(join(home, 'qa-topic-exports'))}
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
  child.on('exit', code => {
    if (code) reject(new Error(`dsh exited ${code}\n${log}`))
  })
})

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PMS_CHROME || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1280 }, deviceScaleFactor: 2 })
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2500)
  await dismissOverlays(page)
  await page.getByRole('button', { name: '个人媒体工作室' }).first().click({ timeout: 15000 })
  await page.getByTestId('studio-root').waitFor({ timeout: 30000 })
  await page.getByTestId('topic-card').first().waitFor()
  await page.getByTestId('qa-pool').waitFor()
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('div, section, p, span')) {
      const text = node.childNodes.length <= 3 ? node.textContent ?? '' : ''
      if (text.includes('Unable to create default workspace')) node.remove()
    }
  })
  const text = await page.getByTestId('topic-center').innerText()
  if (text.includes('01感谢_自学_面试_粉丝_创造')) throw new Error('filename junk is still on the board')
  if (!text.includes('如何制作归纳卡片')) throw new Error(`missing clustered title\n${text.slice(0, 800)}`)
  if (!text.includes('已有回答')) throw new Error('cards are missing the existing answer')
  if (!text.includes('问答选题池')) throw new Error('pool is missing')
  console.log(text.replace(/\s+/g, ' ').slice(0, 900))
  mkdirSync(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, '07-qa-topic-board.png') })
  console.log('shot ok')
} finally {
  await browser.close().catch(() => {})
  child.kill('SIGTERM')
  await new Promise(resolve => child.on('exit', resolve))
}

async function writeSampleLibrary(root) {
  const markdown = join(root, 'Xhs_QA_小红书问答', 'markdown')
  const images = join(root, 'Xhs_QA_小红书问答', 'images')
  const backup = join(root, 'Xhs_QA_小红书问答', 'backup')
  const archive = join(root, 'Archive_归档')
  mkdirSync(markdown, { recursive: true })
  mkdirSync(images, { recursive: true })
  mkdirSync(backup, { recursive: true })
  mkdirSync(archive, { recursive: true })
  const notes = [
    ['归纳-1', '如何制作归纳卡片', '老师可以举个例子嘛，比如像这个您会怎么制作卡片呢😭', '你这个原始材料逻辑有点糟糕，先把结论写成一句，再把例子收成三行。', '2026-11-02 05:08:40', 'Screenshot_card.jpg'],
    ['归纳-2', '如何制作归纳卡片', '这种很乱的材料要怎么收成一张归纳卡片', '先把结论写成一句，例子只留能讲清楚的那一个。', '2026-10-18 11:20:00', 'Screenshot_card.jpg'],
    ['归纳-3', '如何制作归纳卡片', '归纳卡片的正面和背面到底写什么', '正面是一句判断，背面是你自己的例子。', '2026-09-03 08:00:00', 'Screenshot_card.jpg'],
    ['模板-1', '结构化面试是不是背模板', '老师，结构化面试是不是把答案背下来就行', '模板是骨架，句子得是你自己的。', '2026-11-12 19:04:00', 'Screenshot_template.jpg'],
    ['模板-2', '结构化面试是不是背模板', '答题能不能把稿子背下来', '背下来的稿一追问就散。留骨架，换自己的例子。', '2026-08-21 07:40:00', 'Screenshot_template.jpg'],
    ['分析-1', '综合分析怎么找角度', '综合分析题总是在堆材料，不知道先说什么', '先说一句判断，再给两个你真的见过的例子。', '2026-10-02 14:15:00', 'Screenshot_analysis.jpg'],
    ['分析-2', '综合分析怎么找角度', '材料很多的时候怎么下判断', '把材料收成一个矛盾，判断只留一句。', '2026-07-19 09:00:00', 'Screenshot_analysis.jpg'],
    ['时间-1', '答题时间不够怎么办', '还有三十秒的时候怎么收', '先把结论说完，例子只留一个。', '2026-11-08 16:32:00', 'Screenshot_time.jpg'],
    ['时间-2', '答题时间不够怎么办', '时间不够是砍例子还是砍结论', '结论不能砍。例子砍到还听得懂为止。', '2026-06-11 12:00:00', 'Screenshot_time.jpg'],
    ['介绍-1', '自我介绍怎么开头', '自我介绍是不是也要背下来', '用一件你做过的事开头，不要从姓名背到荣誉。', '2026-11-20 10:00:00', 'Screenshot_intro.jpg'],
    ['介绍-2', '自我介绍怎么开头', '开场要不要先报姓名和岗位', '姓名一句就够，后面把岗位和那件事接上。', '2026-09-28 18:22:00', 'Screenshot_intro.jpg'],
  ]
  for (const [file, title, question, answer, createdAt, source] of notes) {
    writeFileSync(join(markdown, `${file}.md`), `---
# ${title}
---
## 原始问题
${question}
---
## 回答
${answer}
---
## 元信息
- **创建时间**: ${createdAt}
- **来源文件**: ${source}
---
`)
  }
  writeFileSync(join(backup, '旧问题.md'), `---
# 备份里的旧问题
---
## 原始问题
这条在 backup 里，不该变成选题。
---
## 回答
不该出现。
---
## 元信息
- **创建时间**: 2026-01-01 00:00:00
- **来源文件**: old.jpg
---
`)
  writeFileSync(join(root, 'Xhs_QA_小红书问答', '问答.xlsx'), 'spreadsheet')
  writeFileSync(join(archive, '自我介绍.md'), '# 自我介绍怎么开头\n\n这条已经发过。')
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#1E5A43' } }).jpeg().toFile(join(images, 'Screenshot_card.jpg'))
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#102A3C' } }).jpeg().toFile(join(images, '01感谢_自学_面试_粉丝_创造.jpg'))
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
    if (await page.getByRole('dialog').count()) {
      await page.keyboard.press('Escape').catch(() => {})
      clicked = true
    }
    if (!clicked) break
  }
}
