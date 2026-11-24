import { describe, expect, it } from 'vitest'
import { composeArticle, wordingOf } from '../src/article.ts'

describe('article composition', () => {
  it('keeps the author wording while adding structure', () => {
    const spoken = [
      '为什么我认为，结构化面试是最重要、最基础的面试方式。我想介绍一下：为什么我觉得结构化面试是最重要、最基础的一种面试方式。',
      '我们讲结构化面试，本意说的是它的出题方式是结构化的。但在实际训练的过程中，我们会发现，我们的回答也应该是结构化的。',
    ]
    const markdown = composeArticle('结构化面试是所有面试的地基', spoken, ['知道，不等于做到。'])
    expect(markdown.startsWith('# 结构化面试是所有面试的地基')).toBe(true)
    expect(markdown).toContain('## ')
    expect(markdown).toContain('**')
    expect(markdown).toContain('知道，不等于做到。')
    for (const part of spoken) expect(wordingOf(markdown)).toContain(wordingOf(part))
    expect(markdown).not.toContain('润色')
  })

  it('turns a quoted sentence into a quote without rewriting it', () => {
    const markdown = composeArticle('一句原话', ['「重点是展示，而非说服。」'], [])
    expect(markdown).toContain('> 重点是展示，而非说服。')
    expect(wordingOf(markdown)).toContain('重点是展示，而非说服。')
  })
})