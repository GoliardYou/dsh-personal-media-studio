import { describe, expect, it } from 'vitest'
import { advanceQueue, createQueue, queueProgress } from '../src/client/focusQueue.ts'

describe('聚焦队列状态机', () => {
  it('从点击的那张开始，按看板顺序旋转', () => {
    expect(createQueue(['a', 'b', 'c', 'd'], 'c').queue).toEqual(['c', 'd', 'a', 'b'])
    expect(createQueue(['a', 'b'], 'b').position).toBe(0)
    expect(createQueue([], null).queue).toEqual([])
  })

  it('暂存后不会回到自己：shelved 仍属选题，必须靠本轮已处理集合排除', () => {
    const start = createQueue(['a', 'b', 'c'], 'a')
    const live = new Set(['a', 'b', 'c']) // shelved 依旧留在选题阶段
    const next = advanceQueue(start, live, 'a')
    expect(next?.state.position).toBe(1)
    expect(next?.state.processed).toEqual(['a'])
    expect(next?.wrapped).toBe(false)
    expect(queueProgress(next!.state)).toMatchObject({ completed: 1, total: 3, position: 2 })
  })

  it('队尾循环：本轮走完后回到第一张并标记第 2 轮', () => {
    const end = { queue: ['a', 'b'], position: 1, processed: ['a', 'b'], round: 1 }
    const next = advanceQueue(end, new Set(['a', 'b']), 'b')
    expect(next?.wrapped).toBe(true)
    expect(next?.state.round).toBe(2)
    expect(next?.state.processed).toEqual([])
    expect(next?.state.position).toBe(0)
  })

  it('单卡仍在选题时不会提前结束；离开选题后才结束', () => {
    const one = createQueue(['a'], 'a')
    const again = advanceQueue(one, new Set(['a']), 'a')
    expect(again?.wrapped).toBe(true)
    expect(again?.state.round).toBe(2)
    expect(advanceQueue(one, new Set(), 'a')).toBeNull()
  })

  it('跳过已成熟的卡并报告跳过数量', () => {
    const state = { queue: ['a', 'b', 'c'], position: 0, processed: ['a'], round: 1 }
    const next = advanceQueue(state, new Set(['a', 'c']), 'a')
    expect(next?.state.position).toBe(2)
    expect(next?.skipped).toBe(1)
  })

  it('全部离开选题时结束本轮', () => {
    const state = { queue: ['a', 'b'], position: 0, processed: [], round: 1 }
    expect(advanceQueue(state, new Set(), null)).toBeNull()
  })
})
