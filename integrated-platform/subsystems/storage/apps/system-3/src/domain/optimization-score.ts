/** Project-defined reference scores. Rubric changes do not change measurements. */
export interface ScoreInput {
  valid: boolean
  baselineSeconds?: number
  optimizedSeconds?: number
  baselineRead?: number
  optimizedRead?: number
  baselineWrite?: number
  optimizedWrite?: number
  baselineIo?: number
  optimizedIo?: number
  baselineNetwork?: number
  optimizedNetwork?: number
}

export type ScoreRubric = 'core-v3' | 'io-total-v1' | 'resource-v2'

export interface ScoreItem {
  key: string
  label: string
  reductionPercent: number
  targetPercent: number
  weight: number
  points: number
}

export interface OptimizationScore {
  total: number
  items: ScoreItem[]
  rubric: ScoreRubric
}

export function calculateOptimizationScore(input: ScoreInput, rubric: ScoreRubric = 'resource-v2'): OptimizationScore | null {
  if (!input.valid) return null
  const rules = rubric === 'resource-v2' ? [
    { key: 'read', label: 'SSD 接口读取', baseline: input.baselineRead, optimized: input.optimizedRead, targetPercent: 30, weight: 30 },
    { key: 'write', label: 'SSD 接口写入', baseline: input.baselineWrite, optimized: input.optimizedWrite, targetPercent: 30, weight: 30 },
    { key: 'network', label: '存储 Pod 发送量', baseline: input.baselineNetwork, optimized: input.optimizedNetwork, targetPercent: 60, weight: 40 },
  ] : [
    { key: 'time', label: '业务回放耗时', baseline: input.baselineSeconds, optimized: input.optimizedSeconds, targetPercent: 50, weight: 40 },
    rubric === 'core-v3'
      ? { key: 'read', label: 'SSD 接口读取', baseline: input.baselineRead, optimized: input.optimizedRead, targetPercent: 40, weight: 30 }
      : { key: 'io', label: '设备接口读写总量', baseline: input.baselineIo, optimized: input.optimizedIo, targetPercent: 20, weight: 30 },
    { key: 'network', label: '存储节点发送量', baseline: input.baselineNetwork, optimized: input.optimizedNetwork, targetPercent: 80, weight: 30 },
  ]
  const items: ScoreItem[] = []
  for (const rule of rules) {
    const { baseline, optimized } = rule
    if (typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline <= 0 ||
        typeof optimized !== 'number' || !Number.isFinite(optimized) || optimized < 0) return null
    const reductionPercent = (1 - optimized / baseline) * 100
    if (!Number.isFinite(reductionPercent)) return null
    const points = rule.weight * Math.min(1, Math.max(0, reductionPercent / rule.targetPercent))
    items.push({ key: rule.key, label: rule.label, reductionPercent, targetPercent: rule.targetPercent, weight: rule.weight, points })
  }
  return { total: items.reduce((sum, item) => sum + item.points, 0), items, rubric }
}
