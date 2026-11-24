import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toXhsMarkdown } from '../src/brand/markdown.ts'
import { PAGE_H, PAGE_W } from '../src/brand/html.ts'
import {
  classifyLibraryPath,
  decodeLibraryName,
  duplicateTopicWarning,
  excludedPath,
  importCatalogMarkdown,
  importImageMapping,
  mergeExcludes,
  normalizeLibraryRoot,
  priceWarnings,
} from '../src/library/profile.ts'
import { AssetLibrary } from '../src/assets.ts'
import { StudioDb } from '../src/db.ts'

describe('lurenjia library rules', () => {
  it('strips U+200B, keeps Windows paths, and skips coaching plus the personal QR', () => {
    expect(decodeLibraryName('差评\u200b截图.png')).toBe('差评截图.png')
    expect(normalizeLibraryRoot('C:/Users/yigel/一个路人甲小红书素材库')).toBe('C:\\Users\\yigel\\一个路人甲小红书素材库')
    const gbk = Buffer.from('好评截图', 'utf8')
    expect(decodeLibraryName(gbk)).toBe('好评截图')
    const excludes = mergeExcludes('lurenjia', [])
    expect(excludedPath('Coaching_Mindmaps_辅导导图/学生A.xmind', excludes)).toBe(true)
    expect(excludedPath('Coaching_Transcription_辅导转录/note.txt', excludes)).toBe(true)
    expect(excludedPath('小红书公众号二维码及商品图片/一个路人甲个人微信二维码.jpg', excludes)).toBe(true)
    expect(excludedPath('Goods_Images_商品图片/好评截图/a.png', excludes)).toBe(false)
    expect(classifyLibraryPath('Goods_Images_商品图片/好评截图/a.png')).toBe('review')
    expect(classifyLibraryPath('Goods_Images_商品图片/pdf_pages/p1.png')).toBe('product-page')
    expect(classifyLibraryPath('Xhs_QA_小红书问答/背模板.md')).toBe('qa')
    expect(priceWarnings('全额退款，只要99元')).toEqual(['待确认'])
    expect(duplicateTopicWarning('结构化面试是地基', ['结构化面试是地基'])).toContain('撞题')
  })

  it('imports unknown image maps and the catalog without copying prices', () => {
    const mapped = importImageMapping({
      '封面.png': { product: '思维总结', tags: ['目录'], price: '39元' },
      '内页.png': '逐字稿',
    })
    expect(mapped[0].uncertain).toContain('待确认')
    expect(mapped[0].product).toBe('')
    expect(mapped[1].product).toBe('逐字稿')
    const products = importCatalogMarkdown('## 思维总结\n- 约2万字\n价格 199元\n## 学习路径\n- 忽略\n')
    expect(products.some(item => item.name.includes('思维总结') && item.price === '待确认' && item.uncertain.includes('待确认'))).toBe(true)
  })

  it('does not index an excluded coaching file or a zero-width duplicate name', async () => {
    const root = mkdtempSync(join('/tmp', 'pms-lib-'))
    mkdirSync(join(root, 'Coaching_Mindmaps_辅导导图'), { recursive: true })
    mkdirSync(join(root, 'Xhs_QA_小红书问答'), { recursive: true })
    writeFileSync(join(root, 'Coaching_Mindmaps_辅导导图', '学生.txt'), '隐私')
    writeFileSync(join(root, 'Xhs_QA_小红书问答', '背\u200b模板.md'), '# 结构化面试是不是背模板\n\n同学问：是不是把稿子背下来就行。')
    const db = new StudioDb(join(root, 'studio.sqlite'))
    const library = new AssetLibrary(db, [root], mergeExcludes('lurenjia', []), join(root, 'thumbs'), '')
    await library.start(false)
    const titles = db.db.prepare(`SELECT rel_path FROM assets`).all() as Array<{ rel_path: string }>
    expect(titles.some(row => row.rel_path.includes('学生'))).toBe(false)
    expect(titles.some(row => row.rel_path.includes('\u200b'))).toBe(false)
    expect(titles.some(row => row.rel_path.includes('背模板'))).toBe(true)
    await library.stop()
    db.close()
  })
})

describe('xhs markdown', () => {
  it('emits front matter and product/screenshot fences the renderer understands', () => {
    const markdown = toXhsMarkdown({
      title: '结构化面试是地基',
      coverTitle: '结构化面试，是所有面试的地基',
      sections: [{ heading: '一、为什么是地基', paragraphs: ['结构化面试的本质是演绎。'] }],
      quotes: ['脑子会了，不等于嘴巴会了。'],
      screenshots: [{ src: './好评.png', caption: '学员好评' }],
      products: [{ name: '思维总结', points: ['93+题型'], image: './目录.png', caption: '目录' }],
    })
    expect(markdown.startsWith('---\ntheme: avatar-green\nsize: standard\n')).toBe(true)
    expect(markdown).toContain('author: 一个路人甲')
    expect(markdown).toContain('```screenshot')
    expect(markdown).toContain('```product')
    expect(markdown).toContain('price: 待确认')
    expect(markdown).toContain('# 结构化面试是地基')
    expect(PAGE_W).toBe(1080)
    expect(PAGE_H).toBe(1440)
  })
})
