import { describe, expect, it } from 'vitest'
import { tidySourceText } from '../src/client/tidy.ts'

describe('tidySourceText', () => {
  it('去掉中文之间被 OCR 切开的空格，但不改字词', () => {
    expect(tidySourceText('自上 手 试一次')).toBe('自上手试一次')
    expect(tidySourceText('每个小 点说两三句话')).toBe('每个小点说两三句话')
  })

  it('保留英文词之间的空格，去掉英文与中文标点之间的多余空白', () => {
    expect(tidySourceText('AI 面试 官 ， 你 好')).toBe('AI 面试官，你好')
  })

  it('把段内软换行合并，段与段之间只留一个空行', () => {
    expect(tidySourceText('第一段第一行\n第一段第二行\n\n\n第二段')).toBe('第一段第一行第一段第二行\n\n第二段')
  })

  it('英文软换行补一个空格', () => {
    expect(tidySourceText('Prompt\nEngineering is a skill')).toBe('Prompt Engineering is a skill')
  })

  it('列表行保留换行，只整理行内空白', () => {
    expect(tidySourceText('1. 第一 句\n2. 第二 句')).toBe('1. 第一句\n2. 第二句')
  })

  it('全角空格和 NBSP 当作普通空白处理', () => {
    expect(tidySourceText('你\u3000好\u00a0，世界')).toBe('你好，世界')
  })
})
