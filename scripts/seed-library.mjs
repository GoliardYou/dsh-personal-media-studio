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
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720">
  <rect width="1600" height="720" fill="#f4efe6"/>
  <rect x="860" y="120" width="520" height="480" rx="36" fill="#fbfbfa" stroke="#1c1917" stroke-width="8"/>
  <rect x="980" y="210" width="280" height="64" rx="14" fill="#1c1917"/>
  <circle cx="1120" cy="390" r="92" fill="#c4552a"/>
  <rect x="1040" y="520" width="160" height="22" rx="8" fill="#d6d3d1"/>
  <text x="120" y="280" font-size="84" font-family="${font}" fill="#1c1917">澄白 Mini</text>
  <text x="120" y="360" font-size="36" font-family="${font}" fill="#6b6258">便携咖啡机 · 暖白机身</text>
  <text x="120" y="430" font-size="28" font-family="${font}" fill="#6b6258">产品主视觉，画面居中铺满</text>
</svg>`)

await poster(join(root, 'images', '澄白Mini-杯壁细节.png'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720">
  <rect width="1600" height="720" fill="#efe6da"/>
  <ellipse cx="1080" cy="520" rx="260" ry="28" fill="#ddd4c6"/>
  <rect x="940" y="250" width="280" height="250" rx="24" fill="#faf7f2" stroke="#1c1917" stroke-width="6"/>
  <path d="M980 250c40-90 220-90 200 0" fill="none" stroke="#c4552a" stroke-width="14"/>
  <text x="120" y="300" font-size="72" font-family="${font}" fill="#1c1917">杯壁上的第一滴</text>
  <text x="120" y="380" font-size="34" font-family="${font}" fill="#6b6258">细节图 · 出水与杯口</text>
</svg>`)

await poster(join(root, 'images', '差评原话-评论截图.png'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720">
  <rect width="1600" height="720" fill="#f7f1ea"/>
  <rect x="80" y="70" width="1440" height="580" rx="28" fill="#fffaf6" stroke="#eadfd4" stroke-width="2"/>
  <text x="140" y="160" font-size="28" font-family="${font}" fill="#be123c">评论</text>
  <text x="140" y="280" font-size="64" font-family="${font}" fill="#1c1917">看着好看，出水太慢</text>
  <text x="140" y="370" font-size="48" font-family="${font}" fill="#44403c">赶时间根本没用。</text>
  <text x="140" y="500" font-size="28" font-family="${font}" fill="#9f1239">差评原话被留在笔记里</text>
  <text x="140" y="560" font-size="24" font-family="${font}" fill="#a8a29e">来源：一次差评的原话.md</text>
</svg>`)

await poster(join(root, 'images', '读者私信-慢是句子.png'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720">
  <rect width="1600" height="720" fill="#e7f0ea"/>
  <text x="100" y="120" font-size="32" font-family="${font}" fill="#14532d">读者私信</text>
  <rect x="100" y="180" width="980" height="160" rx="28" fill="#ffffff"/>
  <text x="140" y="250" font-size="40" font-family="${font}" fill="#1c1917">我反而喜欢那 40 秒。</text>
  <text x="140" y="305" font-size="32" font-family="${font}" fill="#44403c">像把自己的早晨按了暂停。</text>
  <rect x="360" y="390" width="1140" height="180" rx="28" fill="#166534"/>
  <text x="410" y="470" font-size="40" font-family="${font}" fill="#f0fdf4">所以慢不是缺陷，是这台机器的句子。</text>
</svg>`)

console.log(root)
