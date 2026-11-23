import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const root = process.argv[2] ?? new URL('../examples/library/', import.meta.url).pathname
mkdirSync(join(root, 'notes'), { recursive: true })
mkdirSync(join(root, 'images'), { recursive: true })

writeFileSync(join(root, 'notes', '澄白便携咖啡机-卖点.md'), `# 澄白便携咖啡机

出差时我还是想喝到接近手冲的一杯。澄白 Mini 把加热、研磨和萃取收进一只比书还窄的壳里。

## 卖点

- 出水故意偏慢，后段更干净。
- 机身是暖白色，桌上不抢杯子。
- 水箱盖可以单手打开。

我不想把它拍成参数表。我想拍一个人在酒店窗边等那 40 秒。
`, 'utf8')

writeFileSync(join(root, 'notes', '一次差评的原话.md'), `# 一次差评的原话

评论区有人说：「看着好看，出水太慢，赶时间根本没用。」

这句差评我留下来，不是为了反驳，是因为她说中了使用场景：赶时间的早晨，慢就是失败。

另一类读者把这 40 秒当成自己的仪式。两种人都真实。
`, 'utf8')

writeFileSync(join(root, 'notes', '清晨手冲方法论.md'), `# 清晨手冲方法论

我先闻干香，再看第一滴落在杯壁上的颜色。方法本身不复杂，复杂的是你愿不愿意把这几十秒留下来。

如果只能记一个动作：先把杯子温热。
`, 'utf8')

const font = 'WenQuanYi Micro Hei, sans-serif'

async function poster(file, svg) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  await sharp(png).png().toFile(file)
}

await poster(join(root, 'images', '澄白Mini-产品主视觉.png'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500">
  <rect width="1200" height="1500" fill="#f4efe6"/>
  <rect x="330" y="360" width="540" height="760" rx="48" fill="#f7f7f5" stroke="#1c1917" stroke-width="8"/>
  <rect x="430" y="470" width="340" height="80" rx="16" fill="#1c1917"/>
  <circle cx="600" cy="760" r="120" fill="#c4552a"/>
  <rect x="520" y="980" width="160" height="28" rx="8" fill="#d6d3d1"/>
  <text x="80" y="180" font-size="72" font-family="${font}" fill="#1c1917">澄白 Mini</text>
  <text x="80" y="250" font-size="32" font-family="${font}" fill="#6b6258">便携咖啡机 · 产品主视觉</text>
</svg>`)

await poster(join(root, 'images', '澄白Mini-杯壁细节.png'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500">
  <rect width="1200" height="1500" fill="#efe6da"/>
  <ellipse cx="600" cy="980" rx="280" ry="40" fill="#ddd4c6"/>
  <path d="M430 920c40-220 300-220 340 0" fill="none" stroke="#c4552a" stroke-width="18"/>
  <rect x="470" y="860" width="260" height="180" rx="20" fill="#faf7f2" stroke="#1c1917" stroke-width="6"/>
  <text x="80" y="180" font-size="64" font-family="${font}" fill="#1c1917">杯壁上的第一滴</text>
  <text x="80" y="250" font-size="30" font-family="${font}" fill="#6b6258">细节图 · 出水与杯口</text>
</svg>`)

await poster(join(root, 'images', '差评原话-评论截图.png'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
  <rect width="1200" height="1600" fill="#111111"/>
  <rect x="180" y="80" width="840" height="1440" rx="48" fill="#fffaf6"/>
  <text x="230" y="180" font-size="28" font-family="${font}" fill="#be123c">小红书 · 评论截图</text>
  <text x="230" y="280" font-size="42" font-family="${font}" fill="#1c1917">看着好看，出水太慢</text>
  <text x="230" y="360" font-size="32" font-family="${font}" fill="#44403c">赶时间根本没用。</text>
  <rect x="230" y="460" width="700" height="160" rx="20" fill="#fff1f2"/>
  <text x="260" y="530" font-size="30" font-family="${font}" fill="#9f1239">差评原话被保留在笔记里</text>
  <text x="260" y="580" font-size="26" font-family="${font}" fill="#9f1239">来源：一次差评的原话.md</text>
</svg>`)

await poster(join(root, 'images', '读者私信-慢是句子.png'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
  <rect width="1200" height="1600" fill="#e7f0ea"/>
  <text x="80" y="120" font-size="40" font-family="${font}" fill="#14532d">读者私信</text>
  <rect x="80" y="200" width="760" height="180" rx="28" fill="#ffffff"/>
  <text x="120" y="280" font-size="32" font-family="${font}" fill="#1c1917">我反而喜欢那 40 秒。</text>
  <text x="120" y="340" font-size="28" font-family="${font}" fill="#44403c">像把自己的早晨按了暂停。</text>
  <rect x="280" y="460" width="820" height="180" rx="28" fill="#166534"/>
  <text x="320" y="540" font-size="32" font-family="${font}" fill="#f0fdf4">所以慢不是缺陷，</text>
  <text x="320" y="590" font-size="32" font-family="${font}" fill="#f0fdf4">是这台机器的句子。</text>
</svg>`)

console.log(root)
