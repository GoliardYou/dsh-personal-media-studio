/**
 * 聚焦队列的纯状态机。与 React / RPC 解耦，便于单测覆盖循环与跳过语义。
 *
 * 一轮 = 按看板快照顺序处理过的卡片集合。推进只认「仍在选题」且「本轮没处理过」的卡；
 * 一轮走完自动进入下一轮并回到第一张，这就是用户拍板的「队尾循环」。
 */

export interface FocusQueue {
  queue: string[]
  position: number
  /** 本轮已经处理过的卡片 id，防止一轮内回到同一张。 */
  processed: string[]
  round: number
}

export interface AdvanceResult {
  state: FocusQueue
  /** 是否跨轮回到队首 */
  wrapped: boolean
  /** 本步跳过的卡数（已离开选题或本轮已处理） */
  skipped: number
}

/** 按看板顺序拍快照，旋转到 startId；找不到起点时从第一张开始。 */
export function createQueue(ids: string[], startId: string | null): FocusQueue {
  const at = startId ? ids.indexOf(startId) : -1
  const queue = at > 0 ? [...ids.slice(at), ...ids.slice(0, at)] : [...ids]
  return { queue, position: 0, processed: [], round: 1 }
}

/**
 * 推进到下一张。doneId 是刚刚处理完的卡；live 是此刻仍在选题阶段的卡片 id 集合。
 * 返回 null 表示没有可处理的卡（队列为空，或所有卡都已离开选题）。
 */
export function advanceQueue(state: FocusQueue, live: Set<string>, doneId?: string | null): AdvanceResult | null {
  const total = state.queue.length
  if (total === 0) return null

  const handled = new Set(state.processed)
  if (doneId) handled.add(doneId)
  let skipped = 0

  // 先从当前位置往后找；绕回队首也算同一轮内的正常推进。
  for (let step = 1; step <= total; step++) {
    const index = (state.position + step) % total
    const id = state.queue[index]
    if (!live.has(id) || handled.has(id)) {
      skipped++
      continue
    }
    return {
      state: { ...state, position: index, processed: [...handled] },
      wrapped: false,
      skipped,
    }
  }

  // 本轮没有剩余卡：开启新一轮，回到第一张仍在选题的卡。
  for (let step = 1; step <= total; step++) {
    const index = (state.position + step) % total
    const id = state.queue[index]
    if (!live.has(id)) {
      skipped++
      continue
    }
    return {
      state: { queue: state.queue, position: index, processed: [], round: state.round + 1 },
      wrapped: true,
      skipped,
    }
  }
  return null
}

/** 进度口径：已经处理了几张 / 本轮共几张，而不是「当前在第几张」。 */
export function queueProgress(state: FocusQueue) {
  return {
    completed: state.processed.length,
    total: state.queue.length,
    position: state.position + 1,
    round: state.round,
  }
}
